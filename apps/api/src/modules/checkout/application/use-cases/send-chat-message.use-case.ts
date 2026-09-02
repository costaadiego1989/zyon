import { Inject, Injectable, Optional , Logger} from "@nestjs/common";
import type {
  ChatMessageRequest,
  ChatMessageResponse,
  ChatUiBlock,
  CartItem,
  CheckoutSession,
} from "@zyon/shared-types";
import { CHECKOUT_SESSION_REPOSITORY, type CheckoutSessionRepository } from "../../domain/ports/checkout-session.repository.port.js";
import { AGENT_CONTEXT_PORT, type AgentContextPort } from "../../domain/ports/agent-context.port.js";
import { CONVERSATION_PORT, type ConversationPort } from "../../domain/ports/conversation.port.js";
import {
  MERCHANT_REPOSITORY,
  type MerchantRepository
} from "../../../merchant/domain/ports/merchant-repository.port.js";
import {
  deriveChatStage,
  missingFieldsForStage
} from "../../domain/services/customer-extraction.service.js";
import { buildExperienceFromSession } from "../services/checkout-experience.service.js";
import { CHECKOUT_EXPERIENCE_CONFIG, type CheckoutExperienceConfig } from "../../domain/checkout-experience.config.js";
import { CheckoutCustomerService } from "../services/checkout-customer.service.js";
import { CheckoutShippingService } from "../services/checkout-shipping.service.js";
import { CheckoutOfferService } from "../services/checkout-offer.service.js";
import { isSafeGeneratedMessage } from "../../domain/types/safe-generated-message.js";
import { SafeAuthorizedOffer } from "../../domain/types/safe-authorized-offer.js";
import { PROMPT_EXPERIMENT_PORT, type PromptExperimentPort } from "../../domain/ports/prompt-experiment.port.js";
import { PRODUCT_VARIANT_LOOKUP_PORT, type ProductVariantLookupPort } from "../../domain/ports/product-variant-lookup.port.js";
import { ChatToolExecutorService } from "../services/chat-tool-executor.service.js";
import { ChatLlmGatewayService } from "../services/chat-llm-gateway.service.js";
import { ChatContextService, type ChatContextLoaded } from "../services/chat-context.service.js";
import { ChatResponseBuilder } from "../services/chat-response.builder.js";
import { InterventionRuleTextBuilder } from "../services/intervention-rule-text.builder.js";

function structuredCloneDeep<T>(obj: T): T {
  if (typeof globalThis.structuredClone === "function") return globalThis.structuredClone(obj);
  return JSON.parse(JSON.stringify(obj)) as T;
}

@Injectable()
export class SendChatMessageUseCase {
  private readonly logger = new Logger(SendChatMessageUseCase.name);

  constructor(
    @Inject(CHECKOUT_SESSION_REPOSITORY) private readonly sessions: CheckoutSessionRepository,
    @Inject(CONVERSATION_PORT) private readonly conversation: ConversationPort,
    private readonly customerService: CheckoutCustomerService,
    private readonly shippingService: CheckoutShippingService,
    private readonly offerService: CheckoutOfferService,
    private readonly chatContextService: ChatContextService,
    private readonly chatResponseBuilder: ChatResponseBuilder,
    @Inject(CHECKOUT_EXPERIENCE_CONFIG) private readonly experienceConfig: CheckoutExperienceConfig = { platformFeeBrl: 1.99 },
    @Optional() @Inject(AGENT_CONTEXT_PORT) private readonly agentContext?: AgentContextPort,
    @Optional() @Inject(MERCHANT_REPOSITORY) private readonly merchantRepo?: MerchantRepository,
    @Optional() @Inject(PROMPT_EXPERIMENT_PORT) private readonly promptExperiment?: PromptExperimentPort,
    @Optional() @Inject(PRODUCT_VARIANT_LOOKUP_PORT) private readonly productVariantLookup?: ProductVariantLookupPort,
    @Optional() private readonly chatToolExecutor?: ChatToolExecutorService,
    @Optional() private readonly chatLlmGateway?: ChatLlmGatewayService,
  ) {}

  async execute(input: ChatMessageRequest): Promise<ChatMessageResponse> {
    const context = await this.chatContextService.loadContext(
      input.merchant_id,
      input.session_id,
      input.agent_user_id,
      input.agent_id,
      input.user_message
    );

    let working = structuredCloneDeep(context.session);
    const lastAgentTurn = [...context.session.chatHistory].reverse().find((t) => t.role === "agent")?.text;
    const previousStage = deriveChatStage(context.session);

    try {
      working = await this.customerService.processCustomerInput(
        working,
        input.user_message,
        lastAgentTurn,
        context.merchant?.name
      );
    } catch (error: any) {
      if (error.name === "OtpValidationError") {
        return this.buildOtpValidationResponse(input, error.message, context);
      }
      throw error;
    }

    working = await this.shippingService.processShippingState(working, input.user_message);

    const stage = deriveChatStage(working);
    const missingFields = missingFieldsForStage(working, stage);
    const cohortForOffer = (working as any).cohort;
    const offer = cohortForOffer === "holdout"
      ? SafeAuthorizedOffer.noOffer(working.merchantId, working.sessionId)
      : await this.offerService.authorizeOffer(input.user_message, working, context.rules, stage, missingFields);

    const isHoldout = cohortForOffer === "holdout";
    this.logger.debug("chat.routing", { stage, missingFields, rulesCount: context.merchantRules?.length ?? 0, isHoldout });

    let reply: { message: string; objection: import("@zyon/conversation-engine").Objection; suggested_skus?: string[]; blocks?: Array<{ type: string; data?: Record<string, unknown> }> };
    let llmReply: { message: string; objection: import("@zyon/conversation-engine").Objection; suggested_skus?: string[]; blocks?: Array<{ type: string; data?: Record<string, unknown> }> } | null = null;

    const addressVerified = Boolean((working.customer as any)?.address_verified);
    const forceDeterministic = stage === "data_collection"
      || (stage === "shipping" && missingFields && missingFields.length > 0 && !addressVerified);

    if (!isHoldout && !forceDeterministic) {
      const experimentPromptOverride = await this.resolveExperimentPrompt(input.merchant_id, input.session_id);
      llmReply = await this.callLocalLlm(
        input.user_message, context.merchantRules ?? [], context.merchant?.name, working.cart, input.merchant_id, experimentPromptOverride, offer,
        this.buildLlmUiContext(working, context.rules, stage),
      );
    } else if (forceDeterministic) {
      this.logger.debug("chat.routing.forced-deterministic", { stage, missingFields });
    }

    if (llmReply && llmReply.message && llmReply.message !== "Como posso ajudar com o seu pedido?") {
      reply = llmReply;
    } else {
      reply = await this.conversation.reply({
        userMessage: input.user_message,
        brandVoice: context.rules.brandVoice,
        authorizedOffer: isHoldout ? { approved: false, type: "none" } as any : offer,
        agentContext: context.agentContext,
        merchantName: context.merchant?.name,
        cart: working.cart,
        history: working.chatHistory,
        stage,
        missingFields,
        deliverySummary: this.shippingService.summarizeDelivery(working),
        shippingOptions: working.shippingOptions,
        merchantRules: context.merchantRules
      });
    }

    const safetyCheck = isSafeGeneratedMessage(reply.message);
    const safeMessage = safetyCheck.safe
      ? reply.message
      : "Como posso ajudar com o seu pedido?";

    return this.chatResponseBuilder.build({
      reply,
      safeMessage,
      userMessage: input.user_message,
      session: working,
      offer,
      merchant: context.merchant,
      rules: context.rules,
      stage,
      previousStage,
      missingFields,
      isHoldout,
      preSearchedProducts: context.preSearchedProducts,
      merchantId: input.merchant_id,
      sessionId: input.session_id
    });
  }

  private async buildOtpValidationResponse(
    input: ChatMessageRequest,
    errorMsg: string,
    context: ChatContextLoaded
  ): Promise<ChatMessageResponse> {
    const now = new Date().toISOString();
    await this.sessions.appendChatTurn(input.merchant_id, input.session_id, {
      role: "buyer",
      text: input.user_message,
      occurredAt: now
    });
    const updated = await this.sessions.appendChatTurn(input.merchant_id, input.session_id, {
      role: "agent",
      text: errorMsg,
      occurredAt: new Date().toISOString()
    });

    const experience = buildExperienceFromSession(updated, {
      merchantName: context.merchant?.name,
      theme: (context.merchant as any)?.theme,
      couponBoxEnabled: context.rules.couponBoxEnabled,
      rules: context.rules,
      serviceFee: this.experienceConfig.platformFeeBrl
    });

    const isPhoneOtp = Boolean(updated.customer?.phone_otp_code && !updated.customer?.phone_verified);
    const otpMissingField = isPhoneOtp ? "código de verificação do celular" : "código de verificação";
    const otpQuickReplies = isPhoneOtp
      ? ["Reenviar código SMS", "Não recebi o SMS", "Posso usar outro número?"]
      : ["Reenviar código de e-mail", "Não recebi o código", "Qual e-mail foi usado?"];
    const responseExperience = {
      ...experience,
      copy: { ...experience.copy, quick_replies: otpQuickReplies }
    };

    return {
      message: errorMsg,
      objection: "unknown",
      actions: [],
      turns: updated.chatHistory,
      experience: responseExperience,
      stage: "data_collection",
      missing_fields: [otpMissingField]
    };
  }

  private async resolveExperimentPrompt(merchantId: string, sessionId: string): Promise<string | undefined> {
    try {
      const running = await this.promptExperiment?.findRunningExperiment(merchantId);
      if (running && running.variants.length > 0) {
        const hash = this.hashSessionId(sessionId);
        const totalWeight = running.variants.reduce((sum: number, v: any) => sum + v.weight, 0);
        let target = Math.abs(hash) % totalWeight;
        for (const variant of running.variants) {
          target -= variant.weight;
          if (target <= 0) {
            this.logger.log(
              `[experiment] session=${sessionId} → variant="${variant.name}" (exp=${running.id})`,
            );
            return variant.systemPrompt;
          }
        }
      }
    } catch {
      // Non-critical — continue without experiment override
    }
    return undefined;
  }

  private buildLlmUiContext(
    working: CheckoutSession,
    rules: import("@zyon/shared-types").MerchantRules,
    stage: import("@zyon/shared-types").ChatStage
  ) {
    const custAddr = (working.customer as any)?.address;
    const addressFormatted = custAddr?.street
      ? `${custAddr.street}, ${custAddr.number ?? ""}${custAddr.complement ? ", " + custAddr.complement : ""} - ${custAddr.city ?? ""}/${custAddr.state ?? ""}`
      : undefined;
    const paymentMethods: Array<{ key: string; label: string; sub?: string }> = [
      { key: "pix", label: "Pix", sub: "Pagamento instantâneo, sem taxas" },
      { key: "credito", label: "Cartão de crédito", sub: "Parcele em até 12x" },
      { key: "debito", label: "Cartão de débito", sub: "Débito à vista" },
    ];
    if (rules.cryptoPayments && (rules.cryptoPayments as any).enabled) {
      paymentMethods.push({ key: "crypto", label: "Crypto · USDC", sub: "Polygon ou Base" });
    }
    return {
      stage,
      shippingOptions: working.shippingOptions as any,
      paymentMethods,
      address: addressFormatted ? { ...custAddr, formatted: addressFormatted } : undefined,
      addCrossSellItem: (sku: string, quantity: number) =>
        this.addCrossSellItemToCart(working, sku, quantity),
    };
  }

  private async callLocalLlm(
    userMessage: string,
    merchantRules: string[],
    merchantName?: string,
    cart?: { items?: Array<{ name?: string; unit_price?: number }>; total?: number },
    merchantId?: string,
    experimentPromptOverride?: string,
    authorizedOffer?: SafeAuthorizedOffer,
    uiContext?: {
      stage?: string;
      shippingOptions?: Array<{ key: string; label: string; tag?: string; sub?: string; cost?: number }>;
      paymentMethods?: Array<{ key: string; label: string; sub?: string }>;
      address?: { formatted?: string; [k: string]: unknown };
      addCrossSellItem?: (sku: string, quantity: number) => Promise<{ ok: boolean; name?: string; cartBlock?: ChatUiBlock }>;
    },
  ): Promise<{ message: string; objection: import("@zyon/conversation-engine").Objection; suggested_skus?: string[]; blocks?: Array<{ type: string; data?: Record<string, unknown> }> }> {
    if (!this.chatLlmGateway || !this.chatToolExecutor) {
      return { message: "Como posso ajudar com o seu pedido?", objection: "unknown" as any };
    }

    const cartInfo = cart?.total ? `Carrinho: R$${(cart.total / 100).toFixed(2)}` : "";
    const tools = this.chatLlmGateway.getTools();
    const systemPrompt = experimentPromptOverride
      || this.chatLlmGateway.buildSystemPrompt({
        merchantName,
        merchantRules,
        cartInfo,
        stage: uiContext?.stage,
        hasAddress: Boolean(uiContext?.address?.formatted),
        hasShipping: Boolean(uiContext?.shippingOptions?.length),
      });

    const messages: Array<{ role: "system" | "user"; content: string }> = [
      { role: "system", content: systemPrompt },
      { role: "user", content: userMessage },
    ];

    const result = await this.chatLlmGateway.call(messages, tools);
    if (!result) {
      return { message: "Como posso ajudar com o seu pedido?", objection: "unknown" as any };
    }

    if (result.toolCalls.length > 0) {
      const execution = await this.chatToolExecutor.executeToolCalls(
        result.toolCalls,
        {
          merchantId: merchantId || "",
          authorizedOffer,
          shippingOptions: uiContext?.shippingOptions,
          paymentMethods: uiContext?.paymentMethods,
          address: uiContext?.address,
          addCrossSellItem: uiContext?.addCrossSellItem,
        },
      );
      const textContent = result.content?.trim() || "";
      const hasUiBlocks = execution.blocks && execution.blocks.length > 0;
      const fallbackMsg = hasUiBlocks ? "" : "Como posso ajudar com o seu pedido?";
      const finalMsg = execution.message
        ? `${textContent ? textContent + "\n" : ""}${execution.message}`
        : textContent || fallbackMsg;
      const safetyCheck = isSafeGeneratedMessage(finalMsg || "ok");
      const safeMsg = safetyCheck.safe ? finalMsg : fallbackMsg;
      return { message: safeMsg, objection: "unknown" as any, blocks: execution.blocks };
    }

    const safetyCheck = isSafeGeneratedMessage(result.content || "");
    const safeContent = safetyCheck.safe
      ? result.content || "Como posso ajudar com o seu pedido?"
      : "Como posso ajudar com o seu pedido?";
    return { message: safeContent, objection: "unknown" as any };
  }

  private async addCrossSellItemToCart(
    working: CheckoutSession,
    sku: string,
    quantity: number,
  ): Promise<{ ok: boolean; name?: string; cartBlock?: ChatUiBlock }> {
    const qty = Math.max(1, Math.min(99, Math.floor(quantity) || 1));

    let name: string | undefined;
    let price: number | undefined;
    let category: string | undefined;
    let variant: string | undefined;
    let imageUrl: string | undefined;
    try {
      const variantData = await this.productVariantLookup?.findBySku(working.merchantId, sku);
      if (variantData) {
        name = variantData.name;
        price = variantData.price;
        imageUrl = variantData.imageUrl;
      }
    } catch { /* fall back below */ }

    if (price == null || !name) {
      try {
        const variantData = await this.productVariantLookup?.findBySku(working.merchantId, sku);
        if (variantData) {
          name = name ?? variantData.name;
          price = price ?? variantData.price;
          imageUrl = imageUrl ?? variantData.imageUrl;
        }
      } catch { /* keep previous values */ }
      if (!name) name = `Produto ${sku}`;
    }

    const items = [...working.cart.items];
    const existing = items.find((it) => it.sku === sku);
    if (existing) {
      existing.quantity = Math.min(99, existing.quantity + qty);
    } else {
      items.push({ sku, name: name!, price: price!, quantity: qty, category, variant, imageUrl } as CartItem);
    }
    const total = Math.round(items.reduce((s, it) => s + it.price * it.quantity, 0) * 100) / 100;

    working.cart = { ...working.cart, items, total };
    working.shipping = undefined;
    working.updatedAt = new Date().toISOString();
    try {
      await this.sessions.saveSession(working);
    } catch (err) {
      this.logger.warn(`[cross-sell] failed to persist cart add for sku=${sku}`, err as Error);
      return { ok: false };
    }

    const cartBlock: ChatUiBlock = {
      type: "cart_summary",
      data: {
        items: items.map((it) => ({ name: it.name, qty: it.quantity, price: it.price })),
        total,
      },
    };
    return { ok: true, name, cartBlock };
  }

  private hashSessionId(str: string): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash |= 0;
    }
    return hash;
  }

}
