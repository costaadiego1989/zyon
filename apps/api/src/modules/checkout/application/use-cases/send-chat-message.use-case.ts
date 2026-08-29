import { Inject, Injectable, NotFoundException, Optional , Logger} from "@nestjs/common";
import type {
  ChatMessageRequest,
  ChatMessageResponse,
  ChatUiBlock,
  CartItem,
  CheckoutSession,
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
import { CorrelationIdStorage } from "../../../../shared/logger/correlation-id.storage.js";
import { CheckoutCustomerService } from "../services/checkout-customer.service.js";
import { CheckoutShippingService } from "../services/checkout-shipping.service.js";
import { CheckoutOfferService } from "../services/checkout-offer.service.js";
import { CHECKOUT_CROSS_SELL_RECOMMENDER, type CheckoutCrossSellRecommenderPort } from "../../domain/ports/cross-sell-recommender.port.js";
import { resolveCrossSellProduct, resolveCrossSellCartItem } from "../../../cross-sell/application/services/cross-sell-product-resolver.js";
import { PRODUCT_SEARCH_PORT, type ProductSearchPort } from "../../domain/ports/product-search.port.js";
import { TenantBoundaryGuard } from "../../domain/services/tenant-boundary.guard.js";
import { isSafeGeneratedMessage } from "../../domain/types/safe-generated-message.js";
import { SafeAuthorizedOffer } from "../../domain/types/safe-authorized-offer.js";
import { BUYER_CONVERSATION_REPOSITORY, type BuyerConversationRepository } from "../../../buyer-account/domain/ports/buyer-conversation.port.js";
import { PRISMA_CLIENT } from "../../../../shared/persistence/persistence.module.js";
import { ChatToolExecutorService } from "../services/chat-tool-executor.service.js";
import { ChatLlmGatewayService } from "../services/chat-llm-gateway.service.js";
import { CreatePaymentIntentUseCase } from "../../../payment/application/create-payment-intent.use-case.js";
import { randomUUID } from "node:crypto";

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
    @Optional() @Inject(AGENT_CONTEXT_PORT) private readonly agentContext?: AgentContextPort,
    @Optional() @Inject(MERCHANT_REPOSITORY) private readonly merchantRepo?: MerchantRepository,
    @Optional() @Inject(CHECKOUT_CROSS_SELL_RECOMMENDER) private readonly crossSellRecommender?: CheckoutCrossSellRecommenderPort,
    @Optional() @Inject(PRODUCT_SEARCH_PORT) private readonly productSearch?: ProductSearchPort,
    @Optional() @Inject(BUYER_CONVERSATION_REPOSITORY) private readonly conversationRepo?: BuyerConversationRepository,
    @Inject(CHECKOUT_EXPERIENCE_CONFIG) private readonly experienceConfig: CheckoutExperienceConfig = { platformFeeBrl: 1.99 },
    @Optional() @Inject(PRISMA_CLIENT) private readonly prisma?: any,
    @Optional() private readonly chatToolExecutor?: ChatToolExecutorService,
    @Optional() private readonly chatLlmGateway?: ChatLlmGatewayService,
    @Optional() private readonly createPaymentIntent?: CreatePaymentIntentUseCase,
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
    const cohortForOffer = (working as any).cohort;
    const offer = cohortForOffer === "holdout"
      ? SafeAuthorizedOffer.noOffer(working.merchantId, working.sessionId)
      : await this.offerService.authorizeOffer(input.user_message, working, rules, stage, missingFields);

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
      if (this.prisma) {
        const setting = await this.prisma.checkoutSetting.findUnique({
          where: { merchantId: input.merchant_id },
          select: { advancedRules: true, interventionPolicy: true },
        });

      merchantRules = [];

      const policy = setting?.interventionPolicy as { progressiveDiscount?: { enabled: boolean; stages?: { initial_coupon?: number; exit_intent?: number; abandoned_cart?: number; payment_nudge?: number } } } | null;
      if (policy?.progressiveDiscount?.enabled && policy.progressiveDiscount.stages) {
        const s = policy.progressiveDiscount.stages;
        if (s.initial_coupon) merchantRules.push(`SE comprador pede cupom ENTÃO ofereça até ${s.initial_coupon}% de desconto`);
        if (s.exit_intent) merchantRules.push(`SE comprador ameaça sair ENTÃO ofereça até ${s.exit_intent}% de desconto para ficar`);
        if (s.abandoned_cart) merchantRules.push(`SE carrinho abandonado ENTÃO ofereça até ${s.abandoned_cart}% para recuperar`);
        if (s.payment_nudge) merchantRules.push(`SE comprador hesita no pagamento ENTÃO ofereça até ${s.payment_nudge}% para fechar agora`);
      }

      if (setting?.advancedRules) {
        const rules2 = setting.advancedRules as Array<{ enabled: boolean; priority: number; conditions: Array<{ field: string; operator: string; value: string | number | boolean }>; action: { type: string; params: Record<string, string | number> } }>;
        const fieldLabels: Record<string, string> = { cart_total: "carrinho", shipping_cost: "frete", product_in_cart: "produto", category_in_cart: "categoria", coupon_applied: "cupom", buyer_type: "comprador", payment_method: "pagamento", trigger_fired: "trigger", cart_item_count: "itens" };
        const actionLabels = (a: { type: string; params: Record<string, string | number> }) => {
          const map: Record<string, string> = { offer_discount: `ofereça ${a.params.percent || "?"}% de desconto`, offer_free_shipping: "ofereça frete grátis", suggest_product: `sugira ${a.params.productName || "produto"}`, show_message: `diga: "${a.params.message || ""}"`, offer_installments: `ofereça ${a.params.maxInstallments || "?"}x`, do_nothing: "não intervenha", offer_coupon: `ofereça o cupom ${a.params.code || ""}` };
          return map[a.type] || "aja conforme melhor";
        };
        const advRules = rules2.filter(r => r.enabled).sort((a, b) => a.priority - b.priority).map(r => {
          const conds = r.conditions.map(c => `${fieldLabels[c.field] || c.field} ${c.operator} ${c.value}`).join(" E ");
          return `SE ${conds} ENTÃO ${actionLabels(r.action)}`;
        });
        merchantRules.push(...advRules);
      }

      if (merchantRules.length === 0) merchantRules = undefined;
      }
    } catch (rulesErr) {
      this.logger.error("rules.load.failed", { error: rulesErr instanceof Error ? rulesErr.message : String(rulesErr) });
    }

    // Payment-recovery: if the most recent agent turn signals a failed payment,
    // instruct the LLM (for THIS turn) to proactively offer an alternative
    // method. The `payment_failed` event is recorded on the session but not
    // otherwise surfaced to the model, so we derive it from the chat history.
    const paymentJustFailed = /pagamento (falhou|recusad|não foi|nao foi|nao aprovad|não aprovad)/i.test(lastAgentTurn ?? "");
    if (paymentJustFailed) {
      const lastMethod = (working as any).paymentMethod as string | undefined;
      const altHint =
        lastMethod === "pix"
          ? "sugira cartão ou boleto"
          : lastMethod && lastMethod.includes("cart")
            ? "sugira PIX (instantâneo, sem taxas) ou boleto"
            : "sugira PIX ou cartão";
      merchantRules = [
        `O pagamento anterior falhou. Reassegure o comprador com empatia e ${altHint} como alternativa. Não repita o mesmo método que falhou. Seja breve e ofereça ajuda para concluir agora.`,
        ...(merchantRules ?? []),
      ];
    }

    const isHoldout = (working as any).cohort === "holdout";

    let reply: { message: string; objection: import("@zyon/conversation-engine").Objection; suggested_skus?: string[]; blocks?: Array<{ type: string; data?: Record<string, unknown> }> };
    this.logger.debug("chat.routing", { stage, missingFields, rulesCount: merchantRules?.length ?? 0, isHoldout });

    let llmReply: { message: string; objection: import("@zyon/conversation-engine").Objection; suggested_skus?: string[]; blocks?: Array<{ type: string; data?: Record<string, unknown> }> } | null = null;

    // During data_collection, ALWAYS use deterministic path (collects buyer data).
    // During shipping, force deterministic ONLY if address is not yet verified —
    // once address is confirmed, LLM navigation tools guide the next step
    // (show_shipping_options, show_payment_methods, etc).
    const addressVerified = Boolean((working.customer as any)?.address_verified);
    const forceDeterministic = stage === "data_collection"
      || (stage === "shipping" && missingFields && missingFields.length > 0 && !addressVerified);

    if (!isHoldout && !forceDeterministic) {
      let experimentPromptOverride: string | undefined;
      try {
        const running = await this.prisma?.promptExperiment?.findFirst?.({
          where: { merchantId: input.merchant_id, status: "running" },
          include: { variants: true },
        });
        if (running && running.variants.length > 0) {
          const hash = this.hashSessionId(input.session_id);
          const totalWeight = running.variants.reduce((sum: number, v: any) => sum + v.weight, 0);
          let target = Math.abs(hash) % totalWeight;
          for (const variant of running.variants) {
            target -= variant.weight;
            if (target <= 0) {
              experimentPromptOverride = variant.systemPrompt;
              this.logger.log(
                `[experiment] session=${input.session_id} → variant="${variant.name}" (exp=${running.id})`,
              );
              break;
            }
          }
        }
      } catch {
        // Non-critical — continue without experiment override
      }

      // Build UI context so the LLM's navigation tools can emit the right blocks.
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
      llmReply = await this.callLocalLlm(
        input.user_message, merchantRules ?? [], merchant?.name, working.cart, input.merchant_id, experimentPromptOverride, offer,
        {
          stage,
          shippingOptions: working.shippingOptions as any,
          paymentMethods,
          address: addressFormatted ? { ...custAddr, formatted: addressFormatted } : undefined,
          addCrossSellItem: (sku: string, quantity: number) =>
            this.addCrossSellItemToCart(working, sku, quantity),
        },
      );
    } else if (forceDeterministic) {
      this.logger.debug("chat.routing.forced-deterministic", { stage, missingFields });
    }

    if (llmReply && llmReply.message && llmReply.message !== "Como posso ajudar com o seu pedido?") {
      reply = llmReply;
    } else {
      reply = await this.conversation.reply({
        userMessage: input.user_message,
        brandVoice: rules.brandVoice,
        authorizedOffer: isHoldout ? { approved: false, type: "none" } as any : offer,
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
    }

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
    const wantsBoleto = /\bboleto\b/i.test(input.user_message) && stage === "payment";
    const chatActions: any[] = [];
    let suggestedProducts: SuggestedProduct[] = [];

    if (!isHoldout && stage === "payment" && previousStage === "shipping" && this.crossSellRecommender) {
      try {
        suggestedProducts = await this.crossSellRecommender.suggest({
          merchant_id: input.merchant_id,
          session_id: input.session_id,
          cart: working.cart,
          touchpoint: "pre_payment",
        });
      } catch {
        // cross-sell is non-critical; swallow errors
      }
    }

    if (!isHoldout && reply.suggested_skus?.length && suggestedProducts.length === 0) {
      suggestedProducts = reply.suggested_skus.map((sku) => resolveCrossSellProduct(sku, "llm_suggestion"));
    }

    if (suggestedProducts.length === 0 && preSearchedProducts.length > 0) {
      suggestedProducts = preSearchedProducts;
    }


    // Detect payment method selection and advance the session.
    // Persist `paymentMethod` on the session so `deriveChatStage` advances to "completed"
    // and the widget can render the right experience (PIX QR / card form / boleto).
    let selectedPaymentMethod: import("@zyon/shared-types").PaymentMethod | undefined;
    if (wantsPix) selectedPaymentMethod = "pix";
    else if (wantsCard) selectedPaymentMethod = "credit_card";
    else if (wantsBoleto) selectedPaymentMethod = "boleto";

    if (selectedPaymentMethod && !working.paymentMethod) {
      working = {
        ...working,
        paymentMethod: selectedPaymentMethod,
        updatedAt: new Date().toISOString()
      } as typeof working;
      await this.sessions.saveSession(working);
      this.logger.log(`[chat] payment.method.selected ${selectedPaymentMethod} session=${input.session_id}`);
    }


    const responseExperience: typeof experience = suggestedProducts.length > 0
      ? {
        ...experience,
        suggestedProducts
      }
      : experience;

    // Create the payment intent when a method has been selected.
    // Map shared-types PaymentMethod ("credit_card") to payment entity method ("card").
    if (selectedPaymentMethod && this.createPaymentIntent) {
      const intentMethod = selectedPaymentMethod === "credit_card" ? "card" : selectedPaymentMethod;
      // Only pass accepted_offer_id if the offer has actually been APPLIED
      // (cart.currentDiscount > 0 or shipping is now free). Just having
      // `offer.approved === true` means the offer is *proposed*, not applied;
      // passing an unaccepted id fails validateAcceptedOffer.
      const offerApplied =
        offer.approved &&
        ((working.cart.currentDiscount ?? 0) > 0 ||
          (working.shipping?.customerPrice === 0));
      try {
        const intent = await this.createPaymentIntent.execute({
          merchant_id: input.merchant_id,
          session_id: input.session_id,
          idempotency_key: randomUUID(),
          method: intentMethod as any,
          ...(offerApplied ? { accepted_offer_id: offer.id } : {})
        });
        responseExperience.payment_intent = {
          id: intent.id,
          status: intent.status,
          method: selectedPaymentMethod,
          amount_cents: intent.amountCents,
          currency: intent.currency,
          expires_at: intent.buyerFacing?.quoteExpiresAt,
          qr_code: intent.buyerFacing?.qrCodeCopyPaste,
          qr_code_image: intent.buyerFacing?.encodedQrImage,
          copy_paste: intent.buyerFacing?.qrCodeCopyPaste,
          ticket_url: intent.buyerFacing?.invoiceUrl
        };
        this.logger.log(`[chat] payment.intent.created ${intent.id} status=${intent.status} method=${intentMethod}`);
      } catch (payErr) {
        const errMsg = payErr instanceof Error ? payErr.message : String(payErr);
        const errStack = payErr instanceof Error ? payErr.stack : '';
        this.logger.error(`[chat] payment.intent.FAILED session=${input.session_id} method=${intentMethod} error="${errMsg}"`, errStack);
        this.logger.error(`[chat] payment.intent.FAILED detail:`, { merchant_id: input.merchant_id, session_id: input.session_id, method: intentMethod, offerApplied, errorMessage: errMsg });
        responseExperience.payment_intent = undefined;
      }
    }

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

    // Re-derive stage so a payment-method selection reports `payment_pending`
    // (waiting for Asaas webhook to confirm payment before going to `completed`).
    const finalStage = selectedPaymentMethod && working.paymentMethod
      ? "payment_pending"
      : stage;
    const finalMissingFields = finalStage === "payment_pending" || finalStage === "completed"
      ? []
      : missingFields;

    return {
      message: safeMessage,
      objection: reply.objection,
      authorized_offer: authorizedOfferResponse,
      actions: chatActions,
      turns: updated.chatHistory,
      experience: responseExperience,
      stage: finalStage,
      missing_fields: finalMissingFields,
      blocks: reply.blocks
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
      // Navigation tools (show_shipping_options, show_payment_methods) emit blocks
      // without text messages — use a neutral prompt, not "Benefício aplicado".
      const fallbackMsg = hasUiBlocks ? "" : "Como posso ajudar com o seu pedido?";
      const finalMsg = execution.message
        ? `${textContent ? textContent + "\n" : ""}${execution.message}`
        : textContent || fallbackMsg;
      // FIX R2P-C04: Validate FINAL assembled message (tool output + LLM reply)
      const safetyCheck = isSafeGeneratedMessage(finalMsg || "ok");
      const safeMsg = safetyCheck.safe ? finalMsg : fallbackMsg;
      return { message: safeMsg, objection: "unknown" as any, blocks: execution.blocks };
    }

    // FIX R2P-C04: Validate LLM reply before returning
    const safetyCheck = isSafeGeneratedMessage(result.content || "");
    const safeContent = safetyCheck.safe
      ? result.content || "Como posso ajudar com o seu pedido?"
      : "Como posso ajudar com o seu pedido?";
    return { message: safeContent, objection: "unknown" as any };
  }

  /**
   * Adds a cross-sell suggestion to the checkout session cart. Resolves the
   * product from the real catalog (price/name) by SKU, appends/increments the
   * line, recomputes the gross total, invalidates any prior shipping quote
   * (cart changed → freight must be re-selected), persists the session, and
   * returns an updated cart_summary block for the widget.
   */
  private async addCrossSellItemToCart(
    working: CheckoutSession,
    sku: string,
    quantity: number,
  ): Promise<{ ok: boolean; name?: string; cartBlock?: ChatUiBlock }> {
    const qty = Math.max(1, Math.min(99, Math.floor(quantity) || 1));

    // Resolve from the real catalog first; fall back to the deterministic
    // resolver so a missing catalog row never blocks the add.
    let name: string | undefined;
    let price: number | undefined;
    let category: string | undefined;
    let variant: string | undefined;
    let imageUrl: string | undefined;
    try {
      if (this.prisma) {
        const v = await this.prisma.productVariant.findFirst({
          where: { sku, product: { merchantId: working.merchantId } },
          include: { price: true, product: true, media: { orderBy: { order: "asc" }, take: 1 } },
        });
        if (v) {
          name = v.product?.name;
          price = v.price?.basePriceInCents != null ? v.price.basePriceInCents / 100 : undefined;
          imageUrl = v.media?.[0]?.url ?? undefined;
        }
      }
    } catch { /* fall back below */ }

    if (price == null || !name) {
      const resolved = resolveCrossSellCartItem(sku);
      name = name ?? resolved.name;
      price = price ?? resolved.price;
      category = resolved.category;
      variant = resolved.variant;
      imageUrl = imageUrl ?? resolved.imageUrl;
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
    // Cart changed → prior freight quote is stale; force re-selection.
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
