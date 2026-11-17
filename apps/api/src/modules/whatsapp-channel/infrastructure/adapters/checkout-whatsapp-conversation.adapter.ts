import { BadGatewayException, BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException, Optional, UnprocessableEntityException } from "@nestjs/common";
import { SendChatMessageUseCase } from "../../../checkout/application/use-cases/send-chat-message.use-case.js";
import { CHECKOUT_SESSION_REPOSITORY, type CheckoutSessionRepository } from "../../../checkout/domain/ports/checkout-session.repository.port.js";
import type { WhatsAppConversationPort } from "../../domain/ports/whatsapp-conversation.port.js";
import { SendStoreMessageUseCase } from "../../../storefront/application/use-cases/send-store-message.use-case.js";
import { GetStoreConfigUseCase, type StoreConfigOutput } from "../../../storefront/application/use-cases/get-store-config.use-case.js";
import { StartCheckoutUseCase } from "../../../checkout/application/use-cases/start-checkout.use-case.js";
import { EmbedTokenService } from "../../../embed/domain/embed-token.service.js";
import { GetProductContentUseCase } from "../../../catalog/application/use-cases/get-product-content.use-case.js";
import { createHash, randomUUID } from "node:crypto";
import { CheckoutCartAuthorityService } from "../../../checkout/application/services/checkout-cart-authority.service.js";
import type { StoreUiAction, WhatsAppConversationState, WhatsAppStructuredResponse } from "../../domain/ui/meta-ui.types.js";
import { withMetaProductReferences } from "../../domain/ui/meta-product-context.js";
import { deriveChatStage, missingFieldsForStage, isShippingQuickReplyQuestion } from "../../../checkout/domain/services/customer-extraction.service.js";
import { checkoutCollectionCopy } from "../../../checkout/domain/services/checkout-collection-copy.js";
import { isCompleteBuyerAddress } from "../../../checkout/domain/services/buyer-recognition.js";
import { pendingCustomerCorrection } from "../../../checkout/domain/services/customer-correction-prompts.js";
import { containsSharedCpf } from "../../domain/ui/meta-sensitive-input.js";
import { META_FIELD_LABELS, META_FIELD_FLOW_NAMES } from "../../domain/ui/meta-flow.js";
import { CreatePaymentIntentUseCase } from "../../../payment/application/create-payment-intent.use-case.js";
import { GetPaymentIntentStatusUseCase } from "../../../payment/application/get-payment-intent-status.use-case.js";
import { paymentCartFingerprint } from "../../../checkout/domain/services/payment-cart-fingerprint.js";
import { reopenCheckout } from "../../../checkout/domain/services/reopen-checkout.js";
import { PRISMA_CLIENT } from "../../../../shared/persistence/persistence.module.js";
import type { PrismaClient } from "@prisma/client";
import { WhatsAppCheckoutIdentityService } from "../../application/services/whatsapp-checkout-identity.service.js";
import { CheckoutCustomerService } from "../../../checkout/application/services/checkout-customer.service.js";
import { buildExperienceFromSession } from "../../../checkout/application/services/checkout-experience.service.js";
import { checkoutShippingLabel } from "../../../checkout/domain/services/checkout-shipping-label.js";
import { ReopenEmbedCheckoutUseCase } from "../../../embed/application/reopen-embed-checkout.use-case.js";
import { ApplyCouponUseCase } from "../../../coupons/application/use-cases/apply-coupon.use-case.js";
import { PAYMENT_REPOSITORY, type PaymentRepository } from "../../../payment/domain/ports/payment-repository.port.js";
import { CHECKOUT_EXPERIENCE_CONFIG, type CheckoutExperienceConfig } from "../../../checkout/domain/checkout-experience.config.js";
import { metaWelcomeMessage } from "../../domain/ui/meta-ui-renderer.js";
import { presentationAssetUrl, withCartAnimations } from "../../domain/ui/commerce-animations.js";
import { metaCatalogCopy } from "../../domain/ui/meta-compact-presentation.js";
import { buyerHubCommands } from "../../domain/ui/buyer-hub.js";
import { projectPaidOrderReceipt } from "../../../notifications/domain/paid-order-receipt.js";
import { STOREFRONT_CONVERSATION_PORT, type StorefrontConversationPort } from "../../../storefront/domain/ports/conversation.port.js";
import { CheckoutShippingService } from "../../../checkout/application/services/checkout-shipping.service.js";
import type { TrustedWhatsAppCheckoutBuyer } from "../../../checkout/application/services/trusted-checkout-buyer.js";
import { WhatsAppPostCartOfferService } from "../../application/services/whatsapp-post-cart-offer.service.js";
import { WhatsAppBuyerHubService } from "../../application/services/whatsapp-buyer-hub.service.js";
import { CashbackService } from "../../../cashback/application/cashback.service.js";
import { parseCashbackCommand, respondToCashbackCommand } from "../../application/services/cashback-whatsapp.commands.js";
import { parseWhatsAppBenefitCommand, WhatsAppCheckoutBenefitsService } from "../../application/services/whatsapp-checkout-benefits.service.js";
import { STOREFRONT_TELEMETRY_PORT, WHATSAPP_RECOVERY_ORIGIN_EVENT, type StorefrontTelemetryPort } from "../../../storefront/domain/ports/storefront-telemetry.port.js";

@Injectable()
export class CheckoutWhatsAppConversationAdapter implements WhatsAppConversationPort {
  constructor(
    private readonly chat: SendChatMessageUseCase,
    @Inject(CHECKOUT_SESSION_REPOSITORY) private readonly sessions: CheckoutSessionRepository,
    @Optional() private readonly store?: SendStoreMessageUseCase,
    @Optional() private readonly storeConfig?: GetStoreConfigUseCase,
    @Optional() private readonly startCheckout?: StartCheckoutUseCase,
    @Optional() private readonly embedTokens?: EmbedTokenService,
    @Optional() private readonly productContent?: GetProductContentUseCase,
    @Optional() private readonly cartAuthority?: CheckoutCartAuthorityService,
    @Optional() private readonly createPayment?: CreatePaymentIntentUseCase,
    @Optional() private readonly paymentStatus?: GetPaymentIntentStatusUseCase,
    @Optional() @Inject(PRISMA_CLIENT) private readonly prisma?: PrismaClient,
    @Optional() private readonly checkoutIdentity?: WhatsAppCheckoutIdentityService,
    @Optional() private readonly checkoutCustomer?: CheckoutCustomerService,
    @Optional() private readonly reopenCheckout?: ReopenEmbedCheckoutUseCase,
    @Optional() private readonly applyCoupon?: ApplyCouponUseCase,
    @Optional() @Inject(PAYMENT_REPOSITORY) private readonly payments?: PaymentRepository,
    @Optional() @Inject(CHECKOUT_EXPERIENCE_CONFIG) private readonly experienceConfig?: CheckoutExperienceConfig,
    @Optional() @Inject(STOREFRONT_CONVERSATION_PORT) private readonly storefrontConversation?: StorefrontConversationPort,
    @Optional() private readonly checkoutShipping?: CheckoutShippingService,
    @Optional() private readonly postCartOffers?: WhatsAppPostCartOfferService,
    @Optional() private readonly buyerHub?: WhatsAppBuyerHubService,
    @Optional() private readonly cashback?: CashbackService,
    @Optional() private readonly benefits?: WhatsAppCheckoutBenefitsService,
    @Optional() @Inject(STOREFRONT_TELEMETRY_PORT) private readonly telemetry?: StorefrontTelemetryPort,
  ) {}

  async respond(input: { merchantId: string; checkoutSessionId: string; message: string; requestId?: string }) {
    const session = await this.sessions.getSession(input.merchantId, input.checkoutSessionId);
    if (!session || session.merchantId !== input.merchantId) throw new NotFoundException("checkout_session_not_found");
    const benefitResponse = await this.benefits?.respond(session, input.message);
    if (benefitResponse) return benefitResponse;
    if (this.cashback) {
      const cashbackResponse = await respondToCashbackCommand(this.cashback, session, input.message, input.requestId);
      if (cashbackResponse) return cashbackResponse;
    }
    const response = await this.chat.execute({
      merchant_id: input.merchantId,
      session_id: session.sessionId,
      conversation_id: session.conversationId,
      user_message: input.message,
    });
    const parts = [response.message];
    const experience = response.experience;
    for (const product of experience?.suggestedProducts ?? []) {
      parts.push(product.name + " — " + product.unit_price.toLocaleString("pt-BR", { style: "currency", currency: "BRL" }));
    }
    const payment = experience?.payment_intent;
    if (payment && ["pending", "created", "requires_action"].includes(payment.status)) {
      if (payment.copy_paste) parts.push("PIX copia e cola:\n" + payment.copy_paste);
      if (payment.ticket_url) parts.push("Link de pagamento: " + payment.ticket_url);
    }
    const cashbackEnabled = await this.cashback?.isProgramEnabled?.(input.merchantId).catch(() => false) === true;
    return {
      agentMessage: parts.filter(Boolean).join("\n\n"),
      quickReplies: [...new Set([...(experience?.copy.quick_replies ?? []), ...response.actions.map(action => action.label)])]
        .filter(label => cashbackEnabled || !/cashback/i.test(label)),
    };
  }

  async respondStore(input: {
    verifiedSender?: Parameters<NonNullable<WhatsAppConversationPort["respondStore"]>>[0]["verifiedSender"];
    merchantId: string; buyer: { globalUserId: string; phone: string; fullName?: string; email?: string };
    message: string; state: WhatsAppConversationState; action?: StoreUiAction;
    attachmentContext?: string;
    messageId?: string;
  }): Promise<WhatsAppStructuredResponse> {
    if (!this.store || !this.storeConfig) throw new Error("whatsapp_storefront_adapter_unavailable");
    // Renewal retains commercial references, but no authority from the old turn.
    // Every recovered turn must prove the current leased Meta sender again.
    if (input.state.recoveredCheckout) {
      const cart = await this.prisma?.storefrontCart.findUnique({ where: { merchantId_sessionId: {
        merchantId: input.merchantId, sessionId: input.state.conversationId } }, select: { expiresAt: true, items: true } });
      const checkout = input.state.checkoutSessionId ? await this.sessions.getSession(input.merchantId, input.state.checkoutSessionId) : undefined;
      const proof = await this.checkoutIdentity?.recognize({ merchantId: input.merchantId,
        conversationId: input.state.conversationId, phone: input.buyer.phone, verifiedSender: input.verifiedSender });
      const owner = proof?.owner;
      if (!cart || cart.expiresAt.getTime() <= Date.now() || !Array.isArray(cart.items) || cart.items.length === 0
        || !owner || !checkout || checkout.merchantId !== owner.merchantId || checkout.sessionId !== input.state.checkoutSessionId
        || checkout.conversationId !== input.state.checkoutConversationId || checkout.cart.cart_ref !== owner.conversationId
        || checkout.customer?.phone_verified !== true || checkout.customer.phone?.replace(/\D/g, "") !== owner.phone)
        throw new ForbiddenException("whatsapp_recovered_checkout_owner_required");
    }
    const config = await this.storeConfig.executeForMerchant(input.merchantId);
    let resolvedBuyerId = input.buyer.globalUserId;
    const turn = await this.respondStoreTurn(input, config, buyerId => { resolvedBuyerId = buyerId; });
    const response = this.postCartOffers ? await this.postCartOffers.decorate(input.merchantId, turn, { buyerName: input.buyer.fullName }) : turn;
    const cartBlock = response.blocks.find(block => block.type === "cart_summary");
    const stored = await this.prisma?.storefrontCart?.findUnique({
      where: { merchantId_sessionId: { merchantId: input.merchantId, sessionId: response.state.conversationId } },
      select: { items: true, expiresAt: true },
    });
    const cartHasItems = this.prisma?.storefrontCart
      ? !!stored && stored.expiresAt.getTime() > Date.now() && Array.isArray(stored.items) && stored.items.length > 0
      : cartBlock ? Array.isArray((cartBlock.data as any).items) && (cartBlock.data as any).items.length > 0 : response.state.cartHasItems;
    const sender = input.verifiedSender, phone = input.buyer.phone.replace(/\D/g, "");
    // Native shopping has a canonical cart before it has a checkout binding.
    // Reuse its recovery projection without starting checkout or granting any
    // account/contact authority. Empty carts also refresh a stale projection.
    if (this.telemetry && stored && stored.expiresAt.getTime() > Date.now()
      && sender?.deviceId.startsWith("META_CLOUD:") && sender.inboxId && sender.leaseToken
      && phone.length >= 10 && phone.length <= 15 && sender.fromNumber.replace(/\D/g, "") === phone) {
      await this.telemetry.recordEvent({ merchantId: input.merchantId,
        conversationId: response.state.checkoutSessionId ?? response.state.conversationId,
        cartId: response.state.conversationId, globalUserId: resolvedBuyerId,
        event: response.state.checkoutSessionId ? WHATSAPP_RECOVERY_ORIGIN_EVENT : "cart_viewed", metadata: { source: "whatsapp" } },
        { configId: sender.deviceId.slice("META_CLOUD:".length) });
    }
    return { ...response,
      quickReplies: response.quickReplies.filter(label => config.cashbackEnabled === true || !/cashback/i.test(label)),
      state: { ...response.state, cartHasItems } };
  }

  private async respondStoreTurn(input: {
    verifiedSender?: Parameters<NonNullable<WhatsAppConversationPort["respondStore"]>>[0]["verifiedSender"];
    merchantId: string; buyer: { globalUserId: string; phone: string; fullName?: string; email?: string };
    message: string; state: WhatsAppConversationState; action?: StoreUiAction;
    attachmentContext?: string; messageId?: string;
  }, config: StoreConfigOutput, resolveBuyer: (buyerId: string) => void): Promise<WhatsAppStructuredResponse> {
    if (!this.store) throw new Error("whatsapp_storefront_adapter_unavailable");
    const hub = await this.buyerHub?.handle(input, config.name, config.cashbackEnabled === true);
    if (hub?.kind === "reply") {
      if (hub.buyer) resolveBuyer(hub.buyer.globalUserId);
      return hub.response;
    }
    if (hub?.kind === "route") input = { ...input, message: hub.message, action: hub.action, buyer: hub.buyer ?? input.buyer, state: hub.state ?? input.state };
    let state: WhatsAppConversationState = { ...input.state, agentTone: config.agentTone };
    const identitySession = state.checkoutSessionId ? await this.sessions.getSession(input.merchantId, state.checkoutSessionId) : undefined;
    if (!input.action && containsSharedCpf(input.message) && (!identitySession || missingFieldsForStage(identitySession, deriveChatStage(identitySession))[0] !== "telefone")) {
      const message = "🛡️ *Seus dados*\n\nNão é necessário enviar seu CPF nesta etapa. Vamos continuar com seu pedido.";
      if (identitySession) return this.checkoutUi({ message, experience: buildExperienceFromSession(identitySession, { merchantName: config.name }),
        ...(pendingCustomerCorrection(identitySession) === "cpf" ? { missing_fields: ["CPF"] } : {}) }, state, config.name, "Documento não solicitado", input.merchantId);
      return { agentMessage: message, merchantName: config.name, quickReplies: [], blocks: [], state };
    }
    const verifiedBuyer = identitySession?.merchantId === input.merchantId && identitySession.customer?.email_verified === true && identitySession.customer.email?.trim() &&
      identitySession.customer.phone_verified === true && identitySession.customer.phone?.replace(/\D/g, "") === input.buyer.phone.replace(/\D/g, "") &&
      (identitySession.cart as { cart_ref?: string }).cart_ref === state.conversationId
      ? { globalUserId: identitySession.globalUserId, customer: { ...identitySession.customer, email: identitySession.customer.email, email_verified: true as const } } : undefined;
    const emailAnswer = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.message.trim()) ? input.message.trim() : undefined;
    const recognition = (!verifiedBuyer || state.postCartOffer) ? await this.checkoutIdentity?.recognize?.({ merchantId: input.merchantId,
      conversationId: state.conversationId, phone: input.buyer.phone,
      emailHint: emailAnswer ?? identitySession?.customer?.email, verifiedSender: input.verifiedSender }) : undefined;
    const registeredBuyer = recognition?.status === "recognized" ? recognition.buyer : undefined;
    const knownBuyer = verifiedBuyer ?? registeredBuyer;
    // The verified channel also owns an existing guest checkout on this same
    // phone/cart. Keep its canonical identity when cancelling its original Pix;
    // never reassign a pending charge to the recognized account.
    const owner = recognition?.owner;
    const boundBuyer = verifiedBuyer ?? (owner && identitySession?.merchantId === owner.merchantId &&
      identitySession.cart.cart_ref === owner.conversationId && identitySession.customer?.phone_verified === true &&
      identitySession.customer.phone?.replace(/\D/g, "") === owner.phone
      ? { merchantId: owner.merchantId, conversationId: owner.conversationId, globalUserId: identitySession.globalUserId,
        customer: { phone: owner.phone, phone_verified: true as const, email_verified: false as const } } : undefined);
    const shopper = knownBuyer ? { ...input.buyer, globalUserId: knownBuyer.globalUserId, fullName: knownBuyer.customer.fullName, email: knownBuyer.customer.email } : input.buyer;
    resolveBuyer(shopper.globalUserId);
    // The native Meta surface uses this path, not respond(). Only the same
    // verified phone/cart owner may command a monetary operation in its session.
    const cashbackCommand = !input.action && !input.attachmentContext && this.cashback ? parseCashbackCommand(input.message) : null;
    const benefitCommand = !input.action && !input.attachmentContext && this.benefits ? parseWhatsAppBenefitCommand(input.message) : null;
    if (cashbackCommand || benefitCommand) {
      if (!identitySession || !boundBuyer || identitySession.globalUserId !== boundBuyer.globalUserId) {
        return { agentMessage: "Confirme sua identidade no pedido para consultar e usar benefícios desta conta.",
          quickReplies: ["Ver carrinho"], blocks: [], merchantName: config.name, state };
      }
      const commandResponse = cashbackCommand
        ? await respondToCashbackCommand(this.cashback!, identitySession, input.message, input.messageId)
        : await this.benefits!.respond(identitySession, input.message);
      if (commandResponse) {
        const current = await this.sessions.getSession(input.merchantId, identitySession.sessionId);
        if (!current || current.globalUserId !== identitySession.globalUserId) throw new ForbiddenException("whatsapp_checkout_buyer_changed");
        state = { ...state, stage: "checkout" };
        const exp = buildExperienceFromSession(current, { merchantName: config.name, serviceFee: this.experienceConfig?.platformFeeBrl,
          cashbackCents: await this.cashback?.checkoutCashbackCents(current) });
        return this.checkoutUi({ message: commandResponse.agentMessage, experience: exp,
          cashbackQuickReplies: commandResponse.quickReplies,
          blocks: [{ type: "checkout_summary", data: { items: exp.items, totals: exp.totals,
            shippingPending: ["data_collection", "shipping"].includes(exp.stage ?? "") && !exp.shipping } }] },
          state, config.name, input.message, input.merchantId);
      }
    }
    // A name already supplied in this phone-owned checkout is usable for the
    // salutation even before payment. It does not grant account access.
    const greetingName = knownBuyer?.customer.fullName || (identitySession?.merchantId === input.merchantId
      && identitySession.customer?.phone_verified === true
      && identitySession.customer.phone?.replace(/\D/g, "") === input.buyer.phone.replace(/\D/g, "")
      && identitySession.cart.cart_ref === state.conversationId ? identitySession.customer.fullName : undefined)
      || (recognition?.status === "recognized" ? recognition.greetingName : undefined) || input.buyer.fullName;
    const offerResponse = await this.postCartOffers?.handle({ merchantId: input.merchantId, state, message: input.message, action: input.action,
      attachmentContext: input.attachmentContext,
      verifiedOwner: owner?.merchantId === input.merchantId && owner.conversationId === state.conversationId,
      details: async productId => this.store!.execute({ merchant_id: input.merchantId, conversation_id: state.conversationId,
        cart_id: state.conversationId, global_user_id: shopper.globalUserId, user_message: input.message,
        history: state.history, ui_action: { tool: "get_product_details", args: { productId } },
      }, undefined, "whatsapp") });
    if (offerResponse) {
      const added = offerResponse.blocks.find(b => b.type === "cart_add_result" && (b.data as any).status === "succeeded");
      if (added && this.storefrontConversation?.postCartSuggestions) {
        try {
          const suggestions = await this.storefrontConversation.postCartSuggestions({ merchantId: input.merchantId,
            cartId: state.conversationId, addedVariantId: String((added.data as any).variantId) });
          if (suggestions) offerResponse.blocks.push(suggestions);
        } catch { /* A recommendation read cannot replay an acknowledged add. */ }
      }
      return withCartAnimations({ ...offerResponse, merchantName: config.name });
    }
    const firstTurn = state.history.length === 0;
    const greeting = metaWelcomeMessage(config.agentGreeting || "", config.name, config.agentName || "Zyon", config.agentTone, config.storeCategory,
      { fullName: greetingName });
    if (/^\/atalhos?$/i.test(input.message.trim())) {
      const message = "📋 *Menu principal*\n\nEscolha o que deseja fazer no menu abaixo ou continue conversando comigo.";
      state.history = [...state.history, { role: "user", content: input.message }, { role: "assistant", content: message }];
      return { agentMessage: message, quickReplies: buyerHubCommands(config.cashbackEnabled).map(c => c.label), blocks: [{ type: "buyer_hub_actions", data: { scope: "main_menu", choices: [] } }], merchantName: config.name, state };
    }
    state.pendingFlow = undefined;
    const greetingRequest = !input.action && !input.attachmentContext && !state.expectsFreeInput && state.stage !== "checkout"
      && /^(?:oi+|ol[áa]|bom dia|boa tarde|boa noite)[!.,\s👋😊]*$/iu.test(input.message.trim());
    if (greetingRequest || /^(menu|in[ií]cio)[!.\s]*$/i.test(input.message.trim())) {
      state.pendingProductQuestion = undefined;
      state.stage = "store"; state.expectsFreeInput = false;
      const message = greetingRequest && !firstTurn
        ? metaWelcomeMessage("", config.name, config.agentName || "Zyon", config.agentTone, config.storeCategory,
          { fullName: greetingName, returning: true }) : greeting;
      state.history = [...state.history, { role: "user" as const, content: input.message }, { role: "assistant" as const, content: message }].slice(-40);
      const blocks: WhatsAppStructuredResponse["blocks"] = [{ type: "buyer_hub_actions", data: { scope: "main_menu", choices: [] } }];
      if (!state.welcomeAnimationShown) {
        const url = presentationAssetUrl("welcome-v2.webp");
        if (url) {
          blocks.push({ type: "welcome_animation", data: { url } });
          state.welcomeAnimationShown = true;
        }
      }
      return { agentMessage: message, quickReplies: buyerHubCommands(config.cashbackEnabled).map(c => c.label), blocks, merchantName: config.name, state };
    }
    const paymentAction = input.action?.kind === "tool" && ["create_payment", "open_payment_checkout"].includes(input.action.tool);
    const checkoutAction = input.action?.kind === "tool" && ["create_payment", "open_payment_checkout", "edit_checkout", "confirm_checkout_edit", "cancel_checkout_edit", "cancel_coupon_entry", "show_checkout", "checkout_shipping_retry"].includes(input.action.tool);
    const browsing = (input.action?.kind === "tool" && !checkoutAction) || /^(continuar comprando|ver produtos|encontrar produto|categorias|ofertas|ver carrinho|faq|ajuda|suporte|perguntas frequentes|tirar d[uú]vidas|trocas e devolu[cç][oõ]es)$/i.test(input.message.trim());
    if (checkoutAction && state.checkoutSessionId) state.stage = "checkout";
    const paymentStatusRequest = /^verificar pagamento$/i.test(input.message.trim()) && identitySession?.merchantId === input.merchantId &&
      identitySession.cart.cart_ref === state.conversationId && identitySession.customer?.phone_verified === true &&
      identitySession.customer.phone?.replace(/\D/g, "") === input.buyer.phone.replace(/\D/g, "");
    if (paymentStatusRequest) state.stage = "checkout";
    // The checkout owns explicit checkout actions and requested field answers.
    // Ordinary conversation returns to the same storefront agent, retaining
    // the cart, verified identity and original payment for later resumption.
    const nextRequestedField = identitySession ? missingFieldsForStage(identitySession, deriveChatStage(identitySession))[0] : undefined;
    // A payment/freight choice is not a request for arbitrary free text. Store
    // questions still belong to merchant RAG while this choice is pending.
    const awaitingField = identitySession ? !!nextRequestedField && !["forma de pagamento", "frete"].includes(nextRequestedField) : state.expectsFreeInput;
    const shippingAnswer = nextRequestedField === "frete" && (identitySession?.shippingOptions?.some(option =>
      input.message.trim() === checkoutShippingLabel(option) || input.message.trim() === `Escolho o frete ${option.carrier} ${option.method}`) ||
      /^(?:escolho o frete |entrega ·|(?:quero (?:o |a )?(?:frete|entrega) )?mais (?:barat[oa]|r[aá]pid[oa]))/i.test(input.message.trim()));
    const shippingQuestion = nextRequestedField === "frete" && (isShippingQuickReplyQuestion(input.message) || /(?:frete (?:gr[aá]tis|gratuito)|(?:op[cç][oõ]es|prazo|valor|pre[cç]o|transportadora).*(?:frete|entrega)|(?:frete|entrega).*(?:op[cç][oõ]es|prazo|valor|pre[cç]o|transportadora))/i.test(input.message));
    const checkoutInput = state.pendingCoupon || awaitingField || shippingAnswer || shippingQuestion || /^(calcular novamente|verificar pagamento|reenviar c[oó]digo|alterar email|pix|boleto|cart[aã]o de (cr[eé]dito|d[eé]bito))$/i.test(input.message.trim());
    if (state.stage === "checkout" && (browsing || !checkoutAction && !checkoutInput)) {
      state.stage = "store"; state.pendingCoupon = undefined; state.pendingCheckoutEdit = undefined; state.expectsFreeInput = false;
    }
    const resumeLinkedProfile = recognition?.status === "recognized" && recognition.linkedAccount === true && registeredBuyer
      && registeredBuyer.customer.fullName && registeredBuyer.customer.email && state.stage === "checkout" && identitySession
      && (!identitySession.customer?.fullName || !identitySession.customer.email) && boundBuyer && owner
      && identitySession.merchantId === owner.merchantId && identitySession.cart.cart_ref === owner.conversationId
      && input.action?.kind === "tool" && ["show_checkout", "create_payment", "open_payment_checkout"].includes(input.action.tool)
      && !state.payment && !identitySession.paymentMethod && this.prisma
      && !await this.prisma.paymentIntent.findFirst({ where: { merchantId: input.merchantId, sessionId: identitySession.sessionId }, select: { id: true } })
      && !await this.prisma.completedOrder.findFirst({ where: { merchantId: input.merchantId, sessionId: identitySession.sessionId }, select: { id: true } });
    if (resumeLinkedProfile) {
      // Recompose through normal cart admission. Never rewrite the former
      // checkout owner or turn an old payment choice into a new charge.
      state = { ...state, stage: "store", expectsFreeInput: false, checkoutGeneration: (state.checkoutGeneration ?? 0) + 1 };
      input = { ...input, message: "Finalizar compra", action: { kind: "tool", tool: "checkout", args: {} } };
    }
    const recognizedContactAnswer = !!emailAnswer && !!registeredBuyer && state.stage === "checkout" &&
      !!identitySession && identitySession.globalUserId !== registeredBuyer.globalUserId && !state.payment && !identitySession.paymentMethod &&
      !await this.prisma?.paymentIntent.findFirst({ where: { merchantId: input.merchantId, sessionId: identitySession.sessionId }, select: { id: true } }) &&
      !await this.prisma?.completedOrder.findFirst({ where: { merchantId: input.merchantId, sessionId: identitySession.sessionId }, select: { id: true } });
    if (recognizedContactAnswer) state = { ...state, stage: "store", expectsFreeInput: false };
    if (state.stage === "checkout") {
      const sessionId = state.checkoutSessionId || state.conversationId + ":checkout";
      let checkout = await this.sessions.getSession(input.merchantId, sessionId);
      if (!checkout || checkout.merchantId !== input.merchantId) throw new NotFoundException("checkout_session_not_found");
      state = await this.syncPayment(input.merchantId, state);
      const currentTool = input.action?.kind === "tool" ? input.action.tool : undefined;
      if (paymentAction) { state.pendingCheckoutEdit = undefined; state.pendingCoupon = undefined; }
      // A buyer can return after the carrier quote expired. Refresh before
      // authorizing a new payment and ask for a new selection if it changed;
      // an existing pending/approved payment keeps its original snapshot.
      if (!state.payment && this.checkoutShipping && (paymentAction || currentTool === "show_checkout"))
        checkout = await this.checkoutShipping.prepareReturningBuyer(checkout);
      const experience = () => buildExperienceFromSession(checkout!, { merchantName: config.name, serviceFee: this.experienceConfig?.platformFeeBrl });
      if (currentTool === "show_checkout" || paymentStatusRequest) return this.checkoutUi({ message: "Confira seu pedido e as opções atuais.", experience: experience(), resumePayment: true }, state, config.name, input.message, input.merchantId);
      if (["cancel_checkout_edit", "cancel_coupon_entry"].includes(currentTool ?? "")) {
        state.pendingCheckoutEdit = undefined; state.pendingCoupon = undefined;
        return this.checkoutUi({ message: "Tudo bem. Seu pedido foi mantido.", experience: experience() }, state, config.name, input.message, input.merchantId);
      }
      if (currentTool === "edit_checkout" || currentTool === "confirm_checkout_edit") {
        if (!boundBuyer || !this.reopenCheckout || input.action?.kind !== "tool") throw new ForbiddenException("whatsapp_checkout_edit_buyer_required");
        const args = input.action.args;
        if (!["payment", "coupon"].includes(String(args.section)) || args.fingerprint !== paymentCartFingerprint(checkout)) {
          state.pendingCheckoutEdit = undefined;
          return this.checkoutUi({ message: "O pedido mudou. Confira os dados atuais antes de alterar.", experience: experience() }, state, config.name, input.message, input.merchantId);
        }
        const section = args.section as "payment" | "coupon";
        if (currentTool === "edit_checkout" && state.payment && ["pending", "requires_action"].includes(state.payment.status)) {
          state.pendingCheckoutEdit = { section, fingerprint: paymentCartFingerprint(checkout), intentId: state.payment.intentId };
          return this.checkoutUi({ message: "Para alterar o pedido, precisamos cancelar o pagamento pendente. Confirme para continuar." }, state, config.name, input.message, input.merchantId);
        }
        if (currentTool === "confirm_checkout_edit" && (!state.pendingCheckoutEdit || state.pendingCheckoutEdit.section !== section || state.pendingCheckoutEdit.fingerprint !== args.fingerprint || state.pendingCheckoutEdit.intentId !== args.intentId || state.payment?.intentId !== args.intentId)) {
          return this.checkoutUi({ message: "Essa confirmação não corresponde ao pagamento atual. Escolha a opção atual de alteração." }, state, config.name, input.message, input.merchantId);
        }
        try {
          const method = state.pendingCheckoutEdit?.method;
          const reopened = await this.reopenCheckout.execute(input.merchantId, sessionId, section, boundBuyer);
          state.payment = undefined; state.pendingCheckoutEdit = undefined;
          state.paymentGeneration = (state.paymentGeneration ?? 0) + 1;
          state.paymentRevision = reopened.revision ?? state.paymentGeneration;
          const updated = await this.sessions.getSession(input.merchantId, sessionId);
          if (!updated) throw new NotFoundException("checkout_session_not_found");
          if (section === "coupon") state.pendingCoupon = { sessionId, fingerprint: paymentCartFingerprint(updated) };
          return this.checkoutUi({ message: section === "coupon" ? "Envie o código do cupom para validar o desconto." : method === "card" ? "O Pix pendente foi cancelado. Continue com cartão no checkout seguro." : "Pagamento pendente cancelado. Escolha como deseja pagar.",
            experience: reopened.experience, ...(method === "card" ? { blocks: [{ type: "stripe_card", data: {} }], initialPaymentMethod: "card" } : {}) }, state, config.name, input.message, input.merchantId);
        } catch (error) {
          if (!(error instanceof ConflictException || error instanceof BadRequestException || error instanceof ForbiddenException)) throw error;
          return this.checkoutUi({ message: "Ainda não foi possível confirmar o cancelamento. O pedido foi mantido. Verifique o pagamento antes de tentar novamente." }, state, config.name, input.message, input.merchantId);
        }
      }
      if (state.pendingCoupon) {
        if (/^(cancelar( cupom)?|n[aã]o (tenho|possuo) cupom)$/i.test(input.message.trim())) {
          state.pendingCoupon = undefined;
          return this.checkoutUi({ message: "Vamos continuar sem adicionar cupom.", experience: experience() }, state, config.name, input.message, input.merchantId);
        }
        if (!this.applyCoupon || !boundBuyer) throw new ForbiddenException("whatsapp_checkout_coupon_buyer_required");
        const code = input.message.trim().toUpperCase();
        if (!/^[A-Z0-9_-]{1,64}$/.test(code)) return this.checkoutUi({ message: "Envie somente o código do cupom, como LOJA10, ou escolha Cancelar cupom." }, state, config.name, input.message, input.merchantId);
        if (state.pendingCoupon.sessionId !== sessionId || state.pendingCoupon.fingerprint !== paymentCartFingerprint(checkout)) {
          state.pendingCoupon = undefined;
          return this.checkoutUi({ message: "O pedido mudou. Escolha Usar cupom novamente.", experience: experience() }, state, config.name, input.message, input.merchantId);
        }
        try {
          const applied = await this.applyCoupon.executeForCheckout({ merchant_id: input.merchantId, session_id: sessionId, code, expectedVersion: checkout.persistenceVersion });
          state.pendingCoupon = undefined;
          return this.checkoutUi({ message: "Cupom aplicado. Confira o desconto e o total atualizado antes de pagar.", experience: buildExperienceFromSession(applied.session, { merchantName: config.name, rules: applied.rules, serviceFee: this.experienceConfig?.platformFeeBrl }) }, state, config.name, input.message, input.merchantId);
        } catch (error) {
          if (!(error instanceof NotFoundException || error instanceof BadRequestException || error instanceof UnprocessableEntityException || error instanceof ConflictException)) throw error;
          return this.checkoutUi({ message: "Esse cupom não pôde ser aplicado ao pedido. Confira o código e as condições ou envie outro cupom." }, state, config.name, input.message, input.merchantId);
        }
      }
      const missing = missingFieldsForStage(checkout, deriveChatStage(checkout));
      if (missing[0] === "CPF") {
        // Meta prohibits requesting full personal identifiers in WhatsApp. The
        // same checkout continues in the signed web surface for this field.
        return this.checkoutUi({ session_id: checkout.sessionId, conversation_id: checkout.conversationId, missing_fields: missing,
          message: "Para proteger seus dados, preencha seu CPF no checkout seguro. Depois, você pode continuar por aqui.", actions: [] },
          state, config.name, "Continuar no checkout seguro", input.merchantId);
      }
      if (paymentAction) {
        if (input.action?.kind !== "tool" || !["pix", "card", "boleto"].includes(String(input.action.args.method))) throw new Error("whatsapp_payment_action_unavailable");
        if (!["payment", "payment_pending"].includes(deriveChatStage(checkout))) return this.checkoutUi({ message: "Confirme os dados e a entrega antes de pagar.", experience: experience() }, state, config.name, input.message, input.merchantId);
        const method = input.action.args.method as "pix" | "card" | "boleto";
        if (input.action.args.checkoutSessionId !== undefined && input.action.args.checkoutSessionId !== sessionId)
          return this.checkoutUi({ message: "Este botão pertence a outro pedido. Confira as formas de pagamento do pedido atual.", experience: experience() }, state, config.name, input.message, input.merchantId);
        if (state.payment?.status === "approved") return this.checkoutUi({ message: "O pagamento já foi confirmado. Seu pedido não precisa de outro pagamento." }, state, config.name, input.message, input.merchantId);
        const pending = state.payment && ["pending", "requires_action"].includes(state.payment.status);
        // Automatic incentives can change the payment fingerprint. Admit only
        // the current snapshot or its deterministic cancellation/reset; never
        // rebind an archived button to changed items, quantities or prices.
        const resetFingerprint = paymentCartFingerprint(pending ? reopenCheckout(checkout, "payment") : checkout);
        if (input.action.args.fingerprint !== paymentCartFingerprint(checkout) && input.action.args.fingerprint !== resetFingerprint)
          return this.checkoutUi({ message: "O pedido mudou. Confira o resumo atualizado e escolha como deseja pagar.", experience: experience() }, state, config.name, input.message, input.merchantId);
        if (pending && state.payment?.method === method)
          return this.checkoutUi({ message: `Seu pagamento por *${method === "pix" ? "Pix" : "cartão"}* já está pronto. Continue com as instruções abaixo.`, experience: experience(), resumePayment: true }, state, config.name, input.message, input.merchantId);
        const capabilities = await this.startCheckout?.getPaymentCapabilities?.(input.merchantId);
        if (method === "boleto" || capabilities && !capabilities[method]) return this.checkoutUi({ message: "Essa forma de pagamento não está disponível nesta loja. Escolha uma das opções atuais." }, state, config.name, input.message, input.merchantId);
        let paymentChanged = false;
        if (pending) {
          if (!boundBuyer || !this.reopenCheckout) throw new ForbiddenException("whatsapp_checkout_edit_buyer_required");
          let reopened: Awaited<ReturnType<ReopenEmbedCheckoutUseCase["execute"]>>;
          try {
            reopened = await this.reopenCheckout.execute(input.merchantId, sessionId, "payment", boundBuyer);
          } catch (error) {
            if (!(error instanceof ConflictException || error instanceof BadRequestException || error instanceof ForbiddenException)) throw error;
            return this.checkoutUi({ message: "Ainda não consegui confirmar a troca. Mantive o pagamento atual e não gerei outra cobrança. Verifique o estado do pagamento abaixo.", experience: experience(), resumePayment: true }, state, config.name, input.message, input.merchantId);
          }
          state.payment = undefined; state.paymentGeneration = (state.paymentGeneration ?? 0) + 1;
          state.paymentRevision = reopened.revision ?? state.paymentGeneration;
          const updated = await this.sessions.getSession(input.merchantId, sessionId);
          if (!updated) throw new NotFoundException("checkout_session_not_found");
          checkout = this.checkoutShipping ? await this.checkoutShipping.prepareReturningBuyer(updated) : updated;
          if (!["payment", "payment_pending"].includes(deriveChatStage(checkout)) || paymentCartFingerprint(checkout) !== resetFingerprint)
            return this.checkoutUi({ message: "O pagamento anterior foi cancelado. Confira os dados e a entrega atualizados antes de escolher o novo pagamento.", experience: experience() }, state, config.name, input.message, input.merchantId);
          paymentChanged = true;
        }
        // Stripe collects card details in its embedded form on our secure page.
        // Opening it does not change the merchant's selected payment provider.
        if (method === "card" && capabilities?.providers?.card === "stripe") return this.checkoutUi({ message: `*Pagamento seguro com cartão*\n\n${paymentChanged ? "🔄 O pagamento anterior foi cancelado. Agora você pode pagar com *cartão de crédito*.\n\n" : ""}Clique no botão abaixo para concluir a compra. Seu pedido e o frete escolhido serão mantidos durante o processo de checkout.`,
          blocks: [{ type: "stripe_card", data: {} }], initialPaymentMethod: "card" }, state, config.name, input.message, input.merchantId);
        if (!this.createPayment) throw new Error("whatsapp_payment_action_unavailable");
        const generation = state.paymentGeneration ? `:${state.paymentGeneration}` : "";
        const idempotencyKey = `wa_${method}_` + createHash("sha256").update(`${sessionId}:${paymentCartFingerprint(checkout)}${generation}`).digest("hex");
        try {
          const payment = await this.createPayment.execute({ merchant_id: input.merchantId, session_id: sessionId, method,
            idempotency_key: idempotencyKey }, { marketplaceSurface: "v1" });
          state.payment = { intentId: payment.id, sessionId, method, status: payment.status, amount_cents: payment.amountCents,
            copy_paste: payment.buyerFacing?.qrCodeCopyPaste, ticket_url: payment.buyerFacing?.invoiceUrl };
          const updated = await this.sessions.getSession(input.merchantId, sessionId);
          return this.checkoutUi({ message: method === "pix" ? `${paymentChanged ? "🔄 O pagamento anterior foi cancelado. Agora vamos de *Pix*.\n\n" : ""}💠 *Pague por Pix aqui na conversa*\n\nCopie o código enviado abaixo e cole no aplicativo do seu banco, na opção *Pix Copia e Cola*.\n\n⏳ Assim que o pagamento for aprovado, aviso por aqui.`
            : "*Pagamento seguro*\n\nAbra o checkout do provedor no botão abaixo para concluir seu pedido.",
            ...(updated ? { experience: buildExperienceFromSession(updated, { merchantName: config.name, serviceFee: payment.amountBreakdown ? payment.amountBreakdown.platformFeeCents / 100 : undefined }) } : {}) }, state, config.name, input.message, input.merchantId);
        } catch (error) {
          if (error instanceof BadGatewayException) {
            const pending = await this.prisma?.paymentIntent.findUnique({ where: { merchantId_sessionId_idempotencyKey: { merchantId: input.merchantId, sessionId, idempotencyKey } }, select: { id: true, status: true, amountCents: true } });
            if (pending) state.payment = { intentId: pending.id, sessionId, method, status: pending.status, amount_cents: pending.amountCents };
            return this.checkoutUi({ message: "Estamos verificando a resposta do provedor. Não faça outro pagamento enquanto essa verificação estiver pendente." }, state, config.name, input.message, input.merchantId);
          }
          if (!(error instanceof BadRequestException || error instanceof ConflictException)) throw error;
          if (error.message === "asaas_customer_data_incomplete" && !checkout.customer?.cpf) return this.checkoutUi({ missing_fields: ["CPF"],
            message: "Este provedor exige um documento para preparar o pagamento. Informe-o somente no formulário seguro." }, state, config.name, input.message, input.merchantId);
          return this.checkoutUi({ message: "Não foi possível preparar o pagamento agora. Seu pedido foi mantido. Confira os dados e tente novamente.",
            ...(method === "card" ? { blocks: [{ type: "hosted_card_payment", data: {} }], initialPaymentMethod: "card" } : {}) }, state, config.name, input.message, input.merchantId);
        }
      }
      const response = await this.chat.execute({ merchant_id: input.merchantId, session_id: sessionId, conversation_id: checkout.conversationId,
        user_message: input.message, message_id: input.messageId ?? randomUUID() });
      if (recognition?.status === "recognized" && recognition.linkedAccount === true && registeredBuyer?.preferences
        && this.checkoutShipping && !state.payment) {
        const current = await this.sessions.getSession(input.merchantId, sessionId);
        if (current && !current.paymentMethod && current.customer?.address_verified) {
          const prepared = await this.checkoutShipping.prepareReturningBuyer(current, registeredBuyer.preferences.shipping);
          return this.checkoutUi({ ...response,
            previousShippingQuote: checkout.shippingOptions?.[0],
            ...(prepared.shipping ? { message: "🚚 Entrega atualizada conforme sua preferência. Confira o resumo e escolha como pagar." } : {}),
            experience: buildExperienceFromSession(prepared, { merchantName: config.name, serviceFee: this.experienceConfig?.platformFeeBrl }),
            missing_fields: missingFieldsForStage(prepared, deriveChatStage(prepared)), preferredPaymentMethod: registeredBuyer.preferences.payment,
          }, state, config.name, input.message, input.merchantId);
        }
      }
      return this.checkoutUi({ ...response, previousShippingQuote: checkout.shippingOptions?.[0] }, state, config.name, input.message, input.merchantId);
    }
    const action = input.action?.kind === "tool" ? input.action : undefined;
    const pendingQuestion = state.stage === "store" && state.pendingProductQuestion;
    if (pendingQuestion && !input.action && /^(voltar|cancelar|desistir|não quero|nao quero)$/i.test(input.message.trim())) {
      const message = "O envio da pergunta foi cancelado. Como posso ajudar?";
      return { agentMessage: message, quickReplies: ["Ver Respondidas", "Ver Carrinho"], blocks: [], merchantName: config.name,
        state: { ...state, pendingProductQuestion: undefined, expectsFreeInput: false,
          history: [...state.history, { role: "user" as const, content: input.message }, { role: "assistant" as const, content: message }].slice(-24) } };
    }
    const canonicalAction = recognizedContactAnswer || action?.tool === "checkout" ? { tool: "create_checkout_session", args: {} }
      : action ? { tool: action.tool, args: action.args }
      : pendingQuestion ? { tool: "create_question", args: { productId: pendingQuestion.productId, question: input.message } } : undefined;
    if (pendingQuestion) { state.pendingProductQuestion = undefined; state.expectsFreeInput = false; }
    const response = await this.store.execute({
      merchant_id: input.merchantId, conversation_id: state.conversationId, cart_id: state.conversationId,
      user_message: input.message, global_user_id: shopper.globalUserId,
      trusted_buyer_context: { globalUserId: shopper.globalUserId, name: shopper.fullName, phone: shopper.phone, email: shopper.email },
      history: withMetaProductReferences(state), ui_action: canonicalAction,
      attachment_context: input.attachmentContext,
    }, undefined, "whatsapp");
    // A natural-language search with one result should expose its purchase
    // controls immediately. Read through the shared tools without recording a
    // second buyer turn or deriving a variant from the agent's prose.
    if (this.storefrontConversation && !canonicalAction && response.blocks.length &&
      response.blocks.every(block => ["product_carousel", "text", "message"].includes(block.type))) {
      const catalogs = response.blocks.filter(block => block.type === "product_carousel");
      const products = catalogs.flatMap(block => (block.data as any).products ?? []);
      const productId = products[0]?.productId || products[0]?.id;
      if (products.length === 1 && typeof productId === "string" && !catalogs.some(block => (block.data as any).nextCursor || (block.data as any).criteria)) {
        const details = await this.storefrontConversation.reply({ merchantId: input.merchantId, sessionId: state.conversationId,
          cartId: state.conversationId, userMessage: input.message, history: state.history, merchantName: config.name,
          storeCategory: "others", buyerContext: { globalUserId: shopper.globalUserId, name: shopper.fullName, phone: shopper.phone, email: shopper.email },
          uiAction: { tool: "get_product_details", args: { productId } } });
        if (details.blocks.some(block => block.type === "product_card" && (block.data as any).id === productId)) {
          response.blocks = [...response.blocks.filter(block => block.type !== "product_carousel"), ...details.blocks];
          response.suggested_next = details.suggestedNext ?? [];
        }
      }
    }
    if (response.blocks.some(b => ["checkout_prepared", "checkout_redirect"].includes(b.type))) {
      try {
        if (state.recoveredCheckout && identitySession) {
          state = await this.syncPayment(input.merchantId, { ...state, stage: "checkout" });
          return this.checkoutUi({ session_id: identitySession.sessionId, conversation_id: identitySession.conversationId,
            message: "Confira seu pedido e o pagamento existentes.", resumePayment: true,
            experience: buildExperienceFromSession(identitySession, { merchantName: config.name, serviceFee: this.experienceConfig?.platformFeeBrl }) },
            state, config.name, input.message, input.merchantId);
        }
        if (!this.startCheckout) throw new Error("whatsapp_checkout_start_unavailable");
        if (!this.cartAuthority) throw new Error("whatsapp_cart_authority_unavailable");
        const cart = await this.cartAuthority.resolveStorefront(input.merchantId, state.conversationId);
        if (registeredBuyer && identitySession && identitySession.globalUserId !== registeredBuyer.globalUserId && this.prisma &&
          (await this.prisma.paymentIntent.findFirst({ where: { merchantId: input.merchantId, sessionId: identitySession.sessionId,
            status: { notIn: ["cancelled", "failed"] } }, select: { id: true } }) ||
          await this.prisma.completedOrder.findFirst({ where: { merchantId: input.merchantId, sessionId: identitySession.sessionId }, select: { id: true } }))) {
          state = await this.syncPayment(input.merchantId, { ...state, stage: "checkout" });
          return this.checkoutUi({ message: "💳 *Pagamento já iniciado*\n\nVamos manter o pedido e o pagamento existentes. Confira o estado atual antes de iniciar outra cobrança.",
            experience: buildExperienceFromSession(identitySession, { merchantName: config.name, serviceFee: this.experienceConfig?.platformFeeBrl }), resumePayment: true },
            state, config.name, input.message, input.merchantId);
        }
        if (state.checkoutSessionId && await this.prisma?.completedOrder.findFirst({ where: { merchantId: input.merchantId, sessionId: state.checkoutSessionId }, select: { id: true } })) state.checkoutGeneration = (state.checkoutGeneration ?? 0) + 1;
        const fingerprint = createHash("sha256").update(JSON.stringify([input.merchantId, state.conversationId, state.checkoutGeneration ?? 0, cart,
          ...(registeredBuyer ? [registeredBuyer.globalUserId] : [])])).digest("hex").slice(0, 32);
        const emailHint = verifiedBuyer?.customer.email;
        const checkoutBuyer = { globalUserId: shopper.globalUserId, phone: shopper.phone, email: emailHint };
        const checkout = await this.startCheckout.execute({
          merchant_id: input.merchantId, session_id: `wa_checkout_${fingerprint}`,
          customer: { phone: checkoutBuyer.phone, email: checkoutBuyer.email },
        } as any, { storefrontCartRef: state.conversationId, ...(verifiedBuyer ? { trustedBuyer: verifiedBuyer }
          : registeredBuyer ? { trustedWhatsAppBuyer: registeredBuyer } : { trustedPhoneBuyer: checkoutBuyer }) });
        state.stage = "checkout";
        // Synchronize payments created on the secure web surface before
        // resuming. Reopening a link must never cancel or create a charge.
        state.checkoutSessionId = checkout.session_id;
        state = await this.syncPayment(input.merchantId, state);
        let session = await this.sessions.getSession(input.merchantId, checkout.session_id);
        if (session && registeredBuyer && this.checkoutShipping) {
          session = await this.checkoutShipping.prepareReturningBuyer(session, registeredBuyer.preferences?.shipping);
          checkout.experience = buildExperienceFromSession(session, { merchantName: config.name, serviceFee: this.experienceConfig?.platformFeeBrl });
        }
        const missing = session ? missingFieldsForStage(session, deriveChatStage(session)) : undefined;
        const message = registeredBuyer && session ? this.returningBuyerMessage(session, registeredBuyer) : undefined;
        return await this.checkoutUi({ ...checkout, ...(message ? { message } : {}), resumePayment: true, missing_fields: missing,
          preferredPaymentMethod: registeredBuyer?.preferences?.payment }, state, config.name, input.message, input.merchantId);
      } catch (error) {
        if (!(error instanceof BadRequestException || error instanceof ConflictException || error instanceof NotFoundException)) throw error;
        const message = "Não consegui preparar a finalização. Confira a disponibilidade dos itens e as condições no carrinho antes de continuar.";
        return { agentMessage: message, quickReplies: ["Ver Carrinho", "Continuar Comprando"], blocks: [], merchantName: config.name,
          state: { ...state, stage: "store", expectsFreeInput: false,
            history: [...state.history, { role: "user" as const, content: input.message }, { role: "assistant" as const, content: message }].slice(-24) } };
      }
    }
    response.message = metaCatalogCopy(response.message, response.blocks);
    state.history = [...state.history, { role: "user" as const, content: input.message }, { role: "assistant" as const, content: response.message }].slice(-24);
    const product = response.blocks.find(b => b.type === "product_card");
    const submission = response.blocks.find(b => b.type === "review_submission");
    const questionContext = response.blocks.find(b => b.type === "question_submission")
      ?? response.blocks.find(b => b.type === "product_question_input") ?? response.blocks.find(b => b.type === "buyer_product_questions")
      ?? response.blocks.find(b => b.type === "product_questions");
    const productId = submission?.data.productId ?? (questionContext?.data as { productId?: string } | undefined)?.productId ?? (product?.data as { id?: string } | undefined)?.id;
    if (productId) {
      if (state.selectedProductId !== productId) { state.selectedVariantId = undefined; state.selectedOptionItemIds = []; state.selectedOptionGroupId = undefined; state.selectedServiceSlotId = undefined; }
      state.selectedProductId = productId;
    }
    if (response.blocks.some(b => b.type === "product_question_input") && productId) {
      state.pendingProductQuestion = { productId }; state.expectsFreeInput = true;
    }
    if (product) {
      const productId = String((product.data as any).id);
      if (this.productContent && (product.data as any).source !== "marketplace") {
        const content = await this.productContent.execute({ merchantId: input.merchantId, productId });
        const contentBlocks = content.blocks.map(block => ({ ...block.props, type: block.type, order: block.order }));
        if (content.faqs.length) contentBlocks.push({ type: "faq", order: contentBlocks.length, items: content.faqs } as any);
        for (const testimonial of content.testimonials) contentBlocks.push({ type: "paragraph", order: contentBlocks.length,
          text: `${testimonial.authorName}${testimonial.rating != null ? ` · ${testimonial.rating} / 5` : ""}\n${testimonial.body}` } as any);
        for (const video of content.videos) contentBlocks.push({ type: "video", order: contentBlocks.length,
          provider: /\.mp4(?:\?|$)/i.test(video.videoUrl) ? "mp4" : "url", ref: video.videoUrl, caption: video.title } as any);
        if (contentBlocks.length) response.blocks.push({ type: "product_content", data: { productId, blocks: contentBlocks } } as any);
      }
    }
    return withCartAnimations({ agentMessage: firstTurn ? `${greeting}\n\n${response.message}` : response.message, quickReplies: response.suggested_next,
      blocks: response.blocks, merchantName: config.name, state });
  }

  private returningBuyerMessage(session: import("@zyon/shared-types").CheckoutSession, buyer: TrustedWhatsAppCheckoutBuyer): string {
    const stage = deriveChatStage(session);
    if (stage === "payment" || stage === "payment_pending") return "👤 *Cadastro reconhecido*\n\n📍 Usamos seu endereço salvo." +
      (session.shipping ? "\n🚚 Frete atualizado conforme sua preferência." : "") +
      "\n\n💳 *Pagamento*\nConfira o resumo e escolha como pagar." + (buyer.preferences ? `\n⭐ Sua preferência: *${buyer.preferences.payment === "pix" ? "Pix" : "cartão"}*.` : "");
    if (stage === "shipping" && session.customer?.address_verified && session.shippingOptions?.length)
      return "👤 *Cadastro reconhecido*\n\n📍 Usamos seu endereço salvo.\n\n🚚 *Escolha a entrega*\nSelecione uma das opções de frete atualizadas abaixo.";
    if (stage === "shipping" && session.customer?.address_verified && session.customer.address?.number)
      return "👤 *Cadastro reconhecido*\n\n📍 Usamos seu endereço salvo.\n\n🚚 *Entrega indisponível no momento*\nNão conseguimos obter uma opção válida de frete. Tente novamente antes de pagar.";
    return "👤 *Cadastro reconhecido*\n\n📝 Vamos completar somente os dados que faltam para seu pedido.";
  }

  private async syncPayment(merchantId: string, state: WhatsAppConversationState): Promise<WhatsAppConversationState> {
    if (!state.checkoutSessionId || !this.payments?.listForSession) return state;
    const snapshots = (await this.payments.listForSession(merchantId, state.checkoutSessionId)).map(intent => intent.snapshot());
    if (snapshots.some(s => s.merchantId !== merchantId || s.sessionId !== state.checkoutSessionId)) throw new ForbiddenException("whatsapp_payment_scope_invalid");
    const current = snapshots.find(s => s.status === "approved") ?? snapshots.find(s => ["pending", "requires_action"].includes(s.status));
    return { ...state, paymentGeneration: Math.max(state.paymentGeneration ?? 0, snapshots.filter(s => s.status === "cancelled").length), payment: current ? {
      intentId: current.id, sessionId: current.sessionId, status: current.status, amount_cents: current.amountCents,
      method: current.method === "crypto" ? undefined : current.method,
      copy_paste: current.buyerFacing?.qrCodeCopyPaste, ticket_url: current.buyerFacing?.invoiceUrl,
    } : undefined };
  }

  private async checkoutUi(response: any, state: WhatsAppConversationState, merchantName: string, userMessage: string, merchantId: string): Promise<WhatsAppStructuredResponse> {
    let exp = response.experience;
    if (exp && this.cashback) {
      const sessionId = response.session_id || state.checkoutSessionId;
      const current = sessionId ? await this.sessions.getSession(merchantId, sessionId) : undefined;
      if (current?.merchantId === merchantId) {
        const projected = buildExperienceFromSession(current, { merchantName, serviceFee: exp.totals?.service_fee,
          cashbackCents: await this.cashback.checkoutCashbackCents(current) });
        exp = { ...exp, totals: projected.totals,
          ...(projected.commercial_benefits_version === undefined ? {} : { commercial_benefits_version: projected.commercial_benefits_version }) };
      }
    }
    let message = response.message || exp?.agent?.greeting || exp?.copy?.message || "Vamos continuar sua compra.";
    const blocks: WhatsAppStructuredResponse["blocks"] = [];
    for (const block of response.blocks ?? []) {
      if (block.type === "shipping_options" && exp?.shippingOptions?.length) continue;
      if (block.type === "payment_methods") continue;
      blocks.push({ type: block.type, data: block.data ?? {} });
    }
    // Recommendations are presented after a confirmed cart addition. The shared
    // experience may retain suggestions, but checkout only exposes its next step.
    if (exp?.payment_intent && ["created", "pending", "requires_action"].includes(exp.payment_intent.status)) blocks.push({ type: "payment_intent", data: exp.payment_intent });
    let summaryFingerprint = state.checkoutSummaryFingerprint;
    if (exp?.items?.length && (!state.checkoutSessionId || state.recoveredCheckout && response.resumePayment || ["payment", "payment_pending", "completed"].includes(exp.stage))) {
      const fingerprint = createHash("sha256").update(JSON.stringify([exp.items, exp.totals, exp.shipping])).digest("hex");
      if (fingerprint !== summaryFingerprint) blocks.push({ type: "checkout_summary", data: { items: exp.items, totals: exp.totals, shippingPending: ["data_collection", "shipping"].includes(exp.stage) && !exp.shipping } });
      summaryFingerprint = fingerprint;
    }
    if (exp?.shippingOptions?.length && exp.stage === "shipping") blocks.push({ type: "shipping_options", data: { options: exp.shippingOptions.map((o: any) => ({ carrier: o.carrier, name: o.method, price: o.customerPrice, days: o.deliveryDays,
      estimatedValue: o.estimatedValue, estimatedUnit: o.estimatedUnit, responseLabel: checkoutShippingLabel(o) })) } } as any);
    const checkoutSessionId = response.session_id || state.checkoutSessionId;
    const session = checkoutSessionId ? await this.sessions.getSession(merchantId, checkoutSessionId) : undefined;
    if (state.payment && state.payment.sessionId !== checkoutSessionId) state.payment = undefined;
    if (state.payment && this.paymentStatus) {
      const status = await this.paymentStatus.execute({ merchant_id: merchantId, session_id: checkoutSessionId!, intent_id: state.payment.intentId });
      state.payment = { ...state.payment, status: status.status };
      if (status.status === "approved") {
        state.pendingCheckoutEdit = undefined; state.pendingCoupon = undefined;
        const payment = await this.prisma?.paymentIntent.findFirst({ where: { id: state.payment.intentId, merchantId, sessionId: checkoutSessionId, status: "approved" } });
        const canonicalPayment = payment?.id === state.payment.intentId && payment.merchantId === merchantId && payment.sessionId === checkoutSessionId &&
          payment.status === "approved" && Number.isSafeInteger(payment.amountCents) && payment.amountCents > 0 && payment.approvedAmountCents === payment.amountCents && payment.providerPaymentId;
        const order = canonicalPayment ? await this.prisma?.completedOrder.findFirst({ where: { merchantId, sessionId: checkoutSessionId, externalOrderId: payment.providerPaymentId! }, select: {
          merchantId: true, sessionId: true, externalOrderId: true, status: true, currency: true,
          orderTotal: true, shippingCents: true, lineItemsJson: true,
        } }) : undefined;
        message = order ? `✅ *Pagamento confirmado!*\n\n🧾 Seu pedido *${order.externalOrderId}* está registrado.\n💬 Você pode consultar o andamento por aqui.` : "✅ *Pagamento confirmado!*\n\n⏳ O registro do pedido está sendo concluído. Você não precisa pagar novamente.";
        // An older checkout experience can still contain pre-discount totals or
        // payment instructions. The approved snapshot owns this receipt.
        for (let i = blocks.length - 1; i >= 0; i--) if (["checkout_summary", "payment_intent", "pix_payment", "payment_actions", "payment_methods", "shipping_options", "form_field", "checkout_form"].includes(blocks[i].type)) blocks.splice(i, 1);
        if (order) {
          const paidReceipt = payment ? projectPaidOrderReceipt(order, payment) : null;
          if (paidReceipt) blocks.push({ type: "order_confirmation", data: { orderId: order.externalOrderId,
            total: paidReceipt.totalPaidCents / 100, paidReceipt, items: [] } } as any);
          else message += "\n\nℹ️ O detalhamento deste recibo ainda não está disponível. Não é necessário pagar novamente.";
        }
      } else if (["pending", "requires_action"].includes(status.status)) {
        if (!state.pendingCheckoutEdit) blocks.push({ type: "payment_intent", data: state.payment });
      }
      else message = "Esse pagamento não está mais disponível. Confira o estado do pedido no checkout seguro.";
    }
    const couponAllowed = (exp?.copy?.quick_replies ?? []).some((label: string) => /cupom/i.test(label)) || state.view?.choices.some(choice => choice.label === "Usar cupom") || !exp?.copy?.quick_replies;
    if (state.pendingCheckoutEdit) blocks.push({ type: "checkout_edit_confirmation", data: state.pendingCheckoutEdit });
    else if (state.pendingCoupon) blocks.push({ type: "coupon_entry", data: {} });
    else if (session && !state.payment && ["payment", "payment_pending"].includes(deriveChatStage(session)) && !response.initialPaymentMethod) {
      const capabilities = await this.startCheckout?.getPaymentCapabilities?.(merchantId) ?? exp?.paymentMethods;
      const methods = [
        ...(capabilities?.pix ? [{ key: "pix", label: "Pix", sub: "Código Pix aqui no WhatsApp" }] : []),
        ...(capabilities?.card ? [{ key: "card", label: "Cartão de crédito", sub: "Checkout seguro do cartão" }] : []),
      ];
      if (response.preferredPaymentMethod) methods.sort((a, b) => Number(b.key === response.preferredPaymentMethod) - Number(a.key === response.preferredPaymentMethod));
      blocks.push({ type: "payment_methods", data: { methods, fingerprint: paymentCartFingerprint(session), nativePayment: true, couponAllowed } });
    } else if (session && !state.payment && response.initialPaymentMethod === "card") {
      const capabilities = await this.startCheckout?.getPaymentCapabilities?.(merchantId) ?? exp?.paymentMethods;
      blocks.push({ type: "payment_method_switch", data: { nativePayment: true, fingerprint: paymentCartFingerprint(session), methods: [
        ...(capabilities?.pix ? [{ key: "pix", label: "Pix" }] : []),
        ...(capabilities?.card ? [{ key: "card", label: "Cartão de crédito" }] : []),
      ] } });
    } else if (session && state.payment && ["pending", "requires_action"].includes(state.payment.status)) {
      const capabilities = await this.startCheckout?.getPaymentCapabilities?.(merchantId) ?? exp?.paymentMethods;
      const methods = [
        ...(capabilities?.pix ? [{ key: "pix", label: "Pix", sub: "Código Pix aqui no WhatsApp" }] : []),
        ...(capabilities?.card ? [{ key: "card", label: "Cartão de crédito", sub: "Checkout seguro do cartão" }] : []),
      ];
      blocks.push({ type: "checkout_edit_actions", data: { fingerprint: paymentCartFingerprint(session), couponAllowed: true, methods } });
    }
    const approved = state.payment?.status === "approved";
    const nextField = approved ? undefined : response.missing_fields?.[0] ?? (session ? missingFieldsForStage(session, deriveChatStage(session))[0] : undefined);
    // Ask the next field explicitly. Starting a checkout must not stop at its greeting.
    const previousQuote = response.previousShippingQuote;
    const currentQuote = session?.shippingOptions?.[0];
    const shippingRefresh = previousQuote?.quoteId && currentQuote?.quoteId && previousQuote.quoteId !== currentQuote.quoteId
      ? previousQuote.expiresAt && Date.parse(previousQuote.expiresAt) <= Date.now() ? "expired" : "updated"
      : undefined;
    const collectionCopy = session && pendingCustomerCorrection(session) ? undefined : checkoutCollectionCopy(nextField, session ?? undefined, state.agentTone, shippingRefresh);
    if (collectionCopy) message = collectionCopy;
    if (nextField === "código de verificação" && session?.customer?.otp_code && !/inválido|expirou|não foi possível|não consegui/i.test(message)) {
      const email = session.customer.email?.replace(/(^.).*(@.*$)/, "$1***$2") || "seu email";
      message = `*Confirme sua conta*\n\nEnviamos um código para *${email}*. Responda aqui com os *6 dígitos*.\n\n_O código vale por 10 minutos. Seus dados salvos serão usados após a confirmação._`;
    }
    if (nextField === "frete" && /frete (?:gr[aá]tis|gratuito)/i.test(userMessage)) {
      const free = session?.shippingOptions?.some(option => option.customerPrice === 0);
      message = `💬 ${free ? "Há uma opção grátis nesta cotação. Confira abaixo." : "Esta cotação não retornou frete grátis. Veja os valores disponíveis abaixo."}\n\n${message}`;
    }
    if (collectionCopy) for (let i = blocks.length - 1; i >= 0; i--) if (["form_field", "checkout_form", "quick_replies"].includes(blocks[i].type)) blocks.splice(i, 1);
    const confirmSavedDelivery = nextField === "confirmar endereço" && session?.customer?.recognized_buyer === true
      && isCompleteBuyerAddress(session.customer.address);
    if (confirmSavedDelivery) {
      const address = session!.customer!.address!;
      const formatted = [address.street, `nº ${address.number}`, address.complement, address.neighborhood,
        `${address.city}/${address.state}`, `CEP ${address.zip!.slice(0, 5)}-${address.zip!.slice(5)}`].filter(Boolean).join(" · ");
      for (let i = blocks.length - 1; i >= 0; i--) if (blocks[i].type === "address_confirmation") blocks.splice(i, 1);
      blocks.push({ type: "address_confirmation", data: { formatted, saved: true } });
      message = "👤 *Cadastro reconhecido*\n\nJá temos seus dados. Deseja receber neste endereço ou informar outro para esta entrega?";
    }
    if (nextField === "frete" && !session?.shippingOptions?.length) blocks.push({ type: "shipping_quote_retry", data: {} });
    const secureIdentifier = nextField === "CPF";
    if (secureIdentifier) message = "Para proteger seus dados, preencha seu CPF no checkout seguro. Depois, você pode continuar por aqui.";
    if (secureIdentifier) for (let i = blocks.length - 1; i >= 0; i--) if (["form_field", "checkout_form"].includes(blocks[i].type)) blocks.splice(i, 1);
    const fields: Record<string, NonNullable<WhatsAppConversationState["pendingFlow"]>["field"]> = { nome: "fullName", email: "email", CPF: "cpf", CEP: "zip", número: "number", "complemento (ou responda que não tem)": "complement" };
    const field = fields[nextField ?? ""];
    const flowName = ["zip", "number", "complement"].includes(field) ? META_FIELD_FLOW_NAMES.address : META_FIELD_FLOW_NAMES.registration;
    const flowId = state.flowIds?.[flowName];
    let pendingFlow: WhatsAppConversationState["pendingFlow"];
    if (field && field !== "cpf" && flowId && checkoutSessionId) {
      pendingFlow = { token: randomUUID(), field, checkoutSessionId, expiresAt: Date.now() + 30 * 60_000 };
      blocks.push({ type: "checkout_form", data: { flowId, token: pendingFlow.token, label: META_FIELD_LABELS[field] } });
    }
    const resumeCard = response.resumePayment && state.payment?.method === "card" && ["pending", "requires_action"].includes(state.payment.status) && !state.payment.ticket_url;
    const needsSecureCheckout = secureIdentifier || resumeCard || blocks.some(block => ["stripe_card", "hosted_card_payment", "crypto_payment"].includes(block.type));
    if (needsSecureCheckout && checkoutSessionId && this.embedTokens && process.env.WIDGET_BASE_URL) {
      const widget = new URL(process.env.WIDGET_BASE_URL);
      if (widget.protocol !== "https:" && !["localhost", "127.0.0.1"].includes(widget.hostname)) throw new Error("whatsapp_checkout_origin_invalid");
      const now = Math.floor(Date.now() / 1000);
      const token = this.embedTokens.sign({ typ: "aacp_embed_v1", merchantId, issuedAtUnix: now, expiresAtUnix: now + 900,
        nonce: randomUUID(), allowedOrigin: widget.origin, storefrontCartRef: state.conversationId, whatsappCheckoutSessionId: checkoutSessionId,
        scopes: ["checkout:start", "checkout:track", "checkout:chat", "payment:intents:create", "payment:intents:read", "payment:intents:confirm", "offers:apply", "coupons:apply"] });
      widget.searchParams.set("embedToken", token); widget.searchParams.set("merchantId", merchantId);
      widget.searchParams.set("channel", "chat");
      const business = await this.prisma?.whatsAppChannelConfig?.findFirst({ where: { merchantId, enabled: true, provider: "META_CLOUD" }, select: { whatsappNumber: true, credentials: true } });
      // Some Brazilian accounts have a provider chat address different from
      // the display number. Use an explicitly verified address when present;
      // never remove the ninth digit from every merchant's number.
      const canonicalPhone = (business?.credentials as Record<string, unknown> | undefined)?.canonicalChatNumber;
      const businessPhone = typeof canonicalPhone === "string" && /^[1-9]\d{7,14}$/.test(canonicalPhone)
        ? canonicalPhone : business?.whatsappNumber?.replace(/\D/g, "");
      if (businessPhone && /^\d{8,15}$/.test(businessPhone)) widget.searchParams.set("whatsappNumber", businessPhone);
      if (response.initialPaymentMethod === "card" || resumeCard) widget.searchParams.set("paymentMethod", "card");
      if (blocks.some(block => block.type === "crypto_payment")) widget.searchParams.set("paymentMethod", "crypto");
      if ((response.initialPaymentMethod === "card" || resumeCard) && state.paymentRevision) widget.searchParams.set("paymentRevision", String(state.paymentRevision));
      const api = process.env.PUBLIC_API_BASE_URL || process.env.API_PUBLIC_URL;
      if (api) widget.searchParams.set("apiBaseUrl", api.endsWith("/v1") ? api : api.replace(/\/$/, "") + "/v1");
      blocks.push({ type: "checkout_redirect", data: { url: widget.href, sessionId: checkoutSessionId,
        purpose: secureIdentifier ? "document" : blocks.some(block => block.type === "crypto_payment") ? "crypto" : "card" } } as any);
    }
    const paymentSurface = blocks.some(block => block.type === "payment_methods") || !!state.payment || !!response.initialPaymentMethod;
    const replies = [...new Set<string>([...(nextField === "código de verificação" || message?.includes("Reenviar código") ? ["Reenviar código", "Alterar email"] : []), ...(exp?.copy?.quick_replies || []), ...(response.actions || []).map((a: any) => a.label)])]
      .filter(label => !paymentSurface || !/^(pix|boleto|cart[aã]o de (cr[eé]dito|d[eé]bito)|remover item|tenho um cupom de desconto)$/i.test(label.trim()));
    return { agentMessage: message, merchantName, blocks,
      quickReplies: approved ? ["Rastrear Pedido", "Continuar Comprando"] : secureIdentifier || state.pendingCheckoutEdit || state.pendingCoupon ? []
        : confirmSavedDelivery ? [] : nextField === "confirmar endereço" ? ["Sim", "Não"] : collectionCopy ? []
          : paymentSurface ? [...(state.payment ? ["Verificar pagamento"] : []), ...(response.cashbackQuickReplies ?? [])] : replies,
      state: { ...state, checkoutSessionId: response.session_id || state.checkoutSessionId, checkoutConversationId: response.conversation_id || state.checkoutConversationId,
        checkoutSummaryFingerprint: summaryFingerprint,
        pendingFlow, expectsFreeInput: !!state.pendingCoupon || !secureIdentifier && !!nextField && /^(telefone|email|nome|CPF|CEP|número|complemento|código de verificação)/i.test(nextField),
        history: [...state.history, { role: "user" as const, content: userMessage }, { role: "assistant" as const, content: message }].slice(-24) } };
  }
}
