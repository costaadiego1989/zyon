import { Inject, Injectable, NotFoundException, Optional } from "@nestjs/common";
import type {
  ChatMessageRequest,
  ChatMessageResponse,
  SuggestedProduct
} from "@zyon/shared-types";
import { DEFAULT_MERCHANT_RULES } from "@zyon/shared-types";
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
import { ListEligibleCrossSellsUseCase } from "../../../cross-sell/application/use-cases/list-eligible-cross-sells.use-case.js";
import { resolveCrossSellProduct } from "../../../cross-sell/application/services/cross-sell-product-resolver.js";
import { PRODUCT_SEARCH_PORT, type ProductSearchPort } from "../../domain/ports/product-search.port.js";
import { TenantBoundaryGuard } from "../../domain/services/tenant-boundary.guard.js";
import { isSafeGeneratedMessage } from "../../domain/types/safe-generated-message.js";
import { BUYER_CONVERSATION_REPOSITORY, type BuyerConversationRepository } from "../../../buyer-account/domain/ports/buyer-conversation.port.js";

function structuredCloneDeep<T>(obj: T): T {
  if (typeof globalThis.structuredClone === "function") return globalThis.structuredClone(obj);
  return JSON.parse(JSON.stringify(obj)) as T;
}

@Injectable()
export class SendChatMessageUseCase {
  constructor(
    @Inject(CHECKOUT_SESSION_REPOSITORY) private readonly sessions: CheckoutSessionRepository,
    @Inject(CONVERSATION_PORT) private readonly conversation: ConversationPort,
    private readonly customerService: CheckoutCustomerService,
    private readonly shippingService: CheckoutShippingService,
    private readonly offerService: CheckoutOfferService,
    @Optional() @Inject(AGENT_CONTEXT_PORT) private readonly agentContext?: AgentContextPort,
    @Optional() @Inject(MERCHANT_REPOSITORY) private readonly merchantRepo?: MerchantRepository,
    @Optional() private readonly crossSellUseCase?: ListEligibleCrossSellsUseCase,
    @Optional() @Inject(PRODUCT_SEARCH_PORT) private readonly productSearch?: ProductSearchPort,
    @Optional() @Inject(BUYER_CONVERSATION_REPOSITORY) private readonly conversationRepo?: BuyerConversationRepository,
    @Inject(CHECKOUT_EXPERIENCE_CONFIG) private readonly experienceConfig: CheckoutExperienceConfig = { platformFeeBrl: 1.99 }
  ) {}

  async execute(input: ChatMessageRequest): Promise<ChatMessageResponse> {
    const session = await this.sessions.getSession(input.merchant_id, input.session_id);
    if (!session) throw new NotFoundException("checkout_session_not_found");
    const rules = await this.merchantRepo?.getRules(input.merchant_id) ?? DEFAULT_MERCHANT_RULES;
    const merchant = await this.merchantRepo?.getProfile(input.merchant_id);

    const lastAgentTurn = [...session.chatHistory].reverse().find((t) => t.role === "agent")?.text;
    const previousStage = deriveChatStage(session);
    let working = structuredCloneDeep(session);

    try {
      working = await this.customerService.processCustomerInput(
        working,
        input.user_message,
        lastAgentTurn,
        merchant?.name
      );
    } catch (error: any) {
      if (error.name === "OtpValidationError") {
        const errorMsg = error.message;

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
          merchantName: merchant?.name,
          theme: merchant?.theme,
          couponBoxEnabled: rules.couponBoxEnabled,
          rules,
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
      throw error;
    }

    working = await this.shippingService.processShippingState(working, input.user_message);

    const stage = deriveChatStage(working);
    const missingFields = missingFieldsForStage(working, stage);
    const offer = await this.offerService.authorizeOffer(input.user_message, working, rules, stage, missingFields);

    TenantBoundaryGuard.assert.merchantIdMatches(
      working.merchantId,
      input.merchant_id,
      "agent context lookup"
    );
    const agentContext = await this.agentContext?.get({
      merchantId: input.merchant_id,
      userId: input.agent_user_id,
      agentId: input.agent_id,
      globalUserId: working.globalUserId
    });

        // Detect product-search intent early when cart is empty
    let preSearchedProducts: SuggestedProduct[] = [];
    if (this.productSearch && isCartEmpty(working.cart)) {
      const searchQuery = extractProductSearchIntent(input.user_message);
      if (searchQuery) {
        try {
          preSearchedProducts = await this.productSearch.execute(input.merchant_id, searchQuery, 6);
        } catch {
          // catalog search non-critical
        }
      }
    }

    // Load merchant advanced rules from checkout settings (advisory)
    let merchantRules: string[] | undefined;
    try {
      const { PrismaClient } = await import("@prisma/client");
      const prisma = new PrismaClient();
      const setting = await prisma.checkoutSetting.findUnique({
        where: { merchantId: input.merchant_id },
        select: { advancedRules: true },
      });
      await prisma.$disconnect();
      if (setting?.advancedRules) {
        const rules2 = setting.advancedRules as Array<{ enabled: boolean; priority: number; conditions: Array<{ field: string; operator: string; value: string | number | boolean }>; action: { type: string; params: Record<string, string | number> } }>;
        const fieldLabels: Record<string, string> = { cart_total: "carrinho", shipping_cost: "frete", product_in_cart: "produto", category_in_cart: "categoria", coupon_applied: "cupom", buyer_type: "comprador", payment_method: "pagamento", trigger_fired: "trigger", cart_item_count: "itens" };
        const actionLabels = (a: { type: string; params: Record<string, string | number> }) => {
          const map: Record<string, string> = { offer_discount: `ofereça ${a.params.percent || "?"}% de desconto`, offer_free_shipping: "ofereça frete grátis", suggest_product: `sugira ${a.params.productName || "produto"}`, show_message: `diga: "${a.params.message || ""}"`, offer_installments: `ofereça ${a.params.maxInstallments || "?"}x`, do_nothing: "não intervenha", offer_coupon: `ofereça o cupom ${a.params.code || ""}` };
          return map[a.type] || "aja conforme melhor";
        };
        merchantRules = rules2.filter(r => r.enabled).sort((a, b) => a.priority - b.priority).map(r => {
          const conds = r.conditions.map(c => `${fieldLabels[c.field] || c.field} ${c.operator} ${c.value}`).join(" E ");
          return `SE ${conds} ENTÃO ${actionLabels(r.action)}`;
        });
      }
    } catch { /* rules are advisory, not critical */ }

    const reply = await this.conversation.reply({
      userMessage: input.user_message,
      brandVoice: rules.brandVoice,
      authorizedOffer: offer,
      agentContext,
      merchantName: merchant?.name,
      cart: working.cart,
      history: working.chatHistory,
      stage,
      missingFields,
      deliverySummary: this.shippingService.summarizeDelivery(working),
      shippingOptions: working.shippingOptions,
      merchantRules
    });

    const safetyCheck = isSafeGeneratedMessage(reply.message);
    const safeMessage = safetyCheck.safe
      ? reply.message
      : "Como posso ajudar com o seu pedido?";

    const now = new Date().toISOString();
    await this.sessions.appendChatTurn(input.merchant_id, input.session_id, {
      role: "buyer",
      text: input.user_message,
      occurredAt: now
    });
    const updated = await this.sessions.appendChatTurn(input.merchant_id, input.session_id, {
      role: "agent",
      text: safeMessage,
      occurredAt: new Date().toISOString(),
      authorizedOfferId: offer.approved ? offer.id : undefined
    });

    const experience = buildExperienceFromSession(updated, {
      merchantName: merchant?.name,
      theme: merchant?.theme,
      agent: agentContext,
      couponBoxEnabled: rules.couponBoxEnabled,
      rules,
      serviceFee: this.experienceConfig.platformFeeBrl
    });

    const wantsPix = /\b(pix|qr code)\b/i.test(input.user_message) && stage === "payment";
    const wantsCard = /\b(cartão|cartao|credito|crédito)\b/i.test(input.user_message) && stage === "payment";
    const chatActions: any[] = [];
    let suggestedProducts: SuggestedProduct[] = [];

    if (stage === "payment" && previousStage === "shipping" && this.crossSellUseCase) {
      try {
        const suggestions = await this.crossSellUseCase.execute({
          session_id: input.session_id,
          merchant_id: input.merchant_id,
          cart: working.cart
        });
        suggestedProducts = suggestions.flatMap((suggestion) =>
          suggestion.ranked_items.map((sku) => resolveCrossSellProduct(sku, suggestion.id))
        );
      } catch {
        // cross-sell is non-critical; swallow errors
      }
    }

    if (reply.suggested_skus?.length && suggestedProducts.length === 0) {
      suggestedProducts = reply.suggested_skus.map((sku) => resolveCrossSellProduct(sku, "llm_suggestion"));
    }

    if (suggestedProducts.length === 0 && preSearchedProducts.length > 0) {
      suggestedProducts = preSearchedProducts;
    }


    const responseExperience = suggestedProducts.length > 0
      ? {
        ...experience,
        suggestedProducts
      }
      : experience;

    if (wantsPix) {
      chatActions.push({ label: "Gerar PIX", type: "continue_checkout" });
    } else if (wantsCard) {
      chatActions.push({ label: "Pagar com Cartão", type: "continue_checkout" });
    } else if (offer.approved && stage === "payment") {
      const alreadyHasDiscount = offer.type.includes("discount") && working.cart.currentDiscount && working.cart.currentDiscount > 0;
      const alreadyHasFreeShipping = offer.type.includes("shipping") && working.shipping?.customerPrice === 0;
      if (!alreadyHasDiscount && !alreadyHasFreeShipping) {
        chatActions.push({ label: "Aplicar oferta", type: "apply_offer", offer_id: offer.id });
      }
    }

    const authorizedOfferResponse = offer.toAuthorizedOffer();

    // Persist conversation history for 30-day buyer recall
    if (this.conversationRepo && updated.globalUserId) {
      try {
        await this.conversationRepo.upsertFromCheckout({
          merchantId: input.merchant_id,
          sessionId: input.session_id,
          globalUserId: updated.globalUserId,
          messages: updated.chatHistory.map((t, idx) => ({
            id: `${input.session_id}_${idx}`,
            role: t.role,
            content: t.text,
            createdAt: new Date(t.occurredAt),
            rating: null
          }))
        });
      } catch {
        // Conversation persistence is best-effort; never block checkout flow
      }
    }

    return {
      message: safeMessage,
      objection: reply.objection,
      authorized_offer: authorizedOfferResponse,
      actions: chatActions,
      turns: updated.chatHistory,
      experience: responseExperience,
      stage,
      missing_fields: missingFields
    };
  }
}

function isCartEmpty(cart: { items?: unknown[] }): boolean {
  return !cart?.items?.length;
}

const SEARCH_PATTERNS = [
  /(?:procur|busc|quer|quero|preciso|tem|vend|mostr)\w*\s+(.{3,60})/i,
  /(?:looking for|show me|i want|do you have)\s+(.{3,60})/i,
];

function extractProductSearchIntent(message: string): string | null {
  for (const pattern of SEARCH_PATTERNS) {
    const match = message.match(pattern);
    if (match?.[1]) return match[1].replace(/[?.!,;]+$/, "").trim();
  }
  return null;
}
