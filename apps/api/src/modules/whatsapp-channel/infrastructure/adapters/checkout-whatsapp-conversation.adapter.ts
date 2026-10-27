import { BadGatewayException, BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException, Optional, UnprocessableEntityException } from "@nestjs/common";
import { SendChatMessageUseCase } from "../../../checkout/application/use-cases/send-chat-message.use-case.js";
import { CHECKOUT_SESSION_REPOSITORY, type CheckoutSessionRepository } from "../../../checkout/domain/ports/checkout-session.repository.port.js";
import type { WhatsAppConversationPort } from "../../domain/ports/whatsapp-conversation.port.js";
import { SendStoreMessageUseCase } from "../../../storefront/application/use-cases/send-store-message.use-case.js";
import { GetStoreConfigUseCase } from "../../../storefront/application/use-cases/get-store-config.use-case.js";
import { StartCheckoutUseCase } from "../../../checkout/application/use-cases/start-checkout.use-case.js";
import { EmbedTokenService } from "../../../embed/domain/embed-token.service.js";
import { GetProductContentUseCase } from "../../../catalog/application/use-cases/get-product-content.use-case.js";
import { createHash, randomUUID } from "node:crypto";
import { CheckoutCartAuthorityService } from "../../../checkout/application/services/checkout-cart-authority.service.js";
import type { StoreUiAction, WhatsAppConversationState, WhatsAppStructuredResponse } from "../../domain/ui/meta-ui.types.js";
import { deriveChatStage, missingFieldsForStage } from "../../../checkout/domain/services/customer-extraction.service.js";
import { META_FIELD_LABELS, META_FIELD_FLOW_NAMES } from "../../domain/ui/meta-flow.js";
import { CreatePaymentIntentUseCase } from "../../../payment/application/create-payment-intent.use-case.js";
import { GetPaymentIntentStatusUseCase } from "../../../payment/application/get-payment-intent-status.use-case.js";
import { paymentCartFingerprint } from "../../../checkout/domain/services/payment-cart-fingerprint.js";
import { PRISMA_CLIENT } from "../../../../shared/persistence/persistence.module.js";
import type { PrismaClient } from "@prisma/client";
import { WhatsAppCheckoutIdentityService } from "../../application/services/whatsapp-checkout-identity.service.js";
import { CheckoutCustomerService, OtpValidationError } from "../../../checkout/application/services/checkout-customer.service.js";
import { buildExperienceFromSession } from "../../../checkout/application/services/checkout-experience.service.js";
import { checkoutShippingLabel } from "../../../checkout/domain/services/checkout-shipping-label.js";
import { ReopenEmbedCheckoutUseCase } from "../../../embed/application/reopen-embed-checkout.use-case.js";
import { ApplyCouponUseCase } from "../../../coupons/application/use-cases/apply-coupon.use-case.js";
import { PAYMENT_REPOSITORY, type PaymentRepository } from "../../../payment/domain/ports/payment-repository.port.js";
import { CHECKOUT_EXPERIENCE_CONFIG, type CheckoutExperienceConfig } from "../../../checkout/domain/checkout-experience.config.js";
import { metaWelcomeMessage } from "../../domain/ui/meta-ui-renderer.js";
import { STOREFRONT_CONVERSATION_PORT, type StorefrontConversationPort } from "../../../storefront/domain/ports/conversation.port.js";

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
  ) {}

  async respond(input: { merchantId: string; checkoutSessionId: string; message: string }) {
    const session = await this.sessions.getSession(input.merchantId, input.checkoutSessionId);
    if (!session || session.merchantId !== input.merchantId) throw new NotFoundException("checkout_session_not_found");
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
    return {
      agentMessage: parts.filter(Boolean).join("\n\n"),
      quickReplies: [...new Set([...(experience?.copy.quick_replies ?? []), ...response.actions.map(action => action.label)])],
    };
  }

  async respondStore(input: {
    merchantId: string; buyer: { globalUserId: string; phone: string; fullName?: string; email?: string };
    message: string; state: WhatsAppConversationState; action?: StoreUiAction;
    attachmentContext?: string;
    messageId?: string;
  }): Promise<WhatsAppStructuredResponse> {
    const response = await this.respondStoreTurn(input);
    const cartBlock = response.blocks.find(block => block.type === "cart_summary");
    const stored = await this.prisma?.storefrontCart?.findUnique({
      where: { merchantId_sessionId: { merchantId: input.merchantId, sessionId: response.state.conversationId } },
      select: { items: true, expiresAt: true },
    });
    const cartHasItems = this.prisma?.storefrontCart
      ? !!stored && stored.expiresAt.getTime() > Date.now() && Array.isArray(stored.items) && stored.items.length > 0
      : cartBlock ? Array.isArray((cartBlock.data as any).items) && (cartBlock.data as any).items.length > 0 : response.state.cartHasItems;
    return { ...response, state: { ...response.state, cartHasItems } };
  }

  private async respondStoreTurn(input: {
    merchantId: string; buyer: { globalUserId: string; phone: string; fullName?: string; email?: string };
    message: string; state: WhatsAppConversationState; action?: StoreUiAction;
    attachmentContext?: string; messageId?: string;
  }): Promise<WhatsAppStructuredResponse> {
    if (!this.store || !this.storeConfig) throw new Error("whatsapp_storefront_adapter_unavailable");
    const config = await this.storeConfig.executeForMerchant(input.merchantId);
    let state = { ...input.state };
    const identitySession = state.checkoutSessionId ? await this.sessions.getSession(input.merchantId, state.checkoutSessionId) : undefined;
    const verifiedBuyer = identitySession?.merchantId === input.merchantId && identitySession.customer?.email_verified === true && identitySession.customer.email?.trim() &&
      identitySession.customer.phone_verified === true && identitySession.customer.phone?.replace(/\D/g, "") === input.buyer.phone.replace(/\D/g, "") &&
      (identitySession.cart as { cart_ref?: string }).cart_ref === state.conversationId
      ? { globalUserId: identitySession.globalUserId, customer: { ...identitySession.customer, email: identitySession.customer.email, email_verified: true as const } } : undefined;
    const shopper = verifiedBuyer ? { ...input.buyer, globalUserId: verifiedBuyer.globalUserId, fullName: verifiedBuyer.customer.fullName, email: verifiedBuyer.customer.email } : input.buyer;
    const firstTurn = state.history.length === 0;
    const greeting = metaWelcomeMessage(config.agentGreeting || `Olá! Sou ${config.agentName || "Zyon"}, sua assistente na ${config.name}.\n\nPosso ajudar você a encontrar produtos, conferir as condições da loja e acompanhar seu pedido.`, config.name, config.agentName || "Zyon");
    state.pendingFlow = undefined;
    if ((firstTurn && /^(oi|ol[áa]|bom dia|boa tarde|boa noite)[!.\s]*$/i.test(input.message.trim())) || /^(menu|in[ií]cio)[!.\s]*$/i.test(input.message.trim())) {
      state.stage = "store"; state.expectsFreeInput = false;
      state.history = [{ role: "user", content: input.message }, { role: "assistant", content: greeting }];
      return { agentMessage: greeting, quickReplies: config.quickReplies || [], blocks: [], merchantName: config.name, state };
    }
    const paymentAction = input.action?.kind === "tool" && ["create_payment", "open_payment_checkout"].includes(input.action.tool);
    const checkoutAction = input.action?.kind === "tool" && ["create_payment", "open_payment_checkout", "edit_checkout", "confirm_checkout_edit", "cancel_checkout_edit", "cancel_coupon_entry", "show_checkout"].includes(input.action.tool);
    const browsing = (input.action?.kind === "tool" && !checkoutAction) || /^(continuar comprando|ver produtos|encontrar produto|categorias|ofertas|ver carrinho)$/i.test(input.message.trim());
    if (checkoutAction && state.checkoutSessionId) state.stage = "checkout";
    // The checkout owns explicit checkout actions and requested field answers.
    // Ordinary conversation returns to the same storefront agent, retaining
    // the cart, verified identity and original payment for later resumption.
    const awaitingField = identitySession ? missingFieldsForStage(identitySession, deriveChatStage(identitySession)).length > 0 : state.expectsFreeInput;
    const checkoutInput = state.pendingCoupon || awaitingField || /^(verificar pagamento|reenviar c[oó]digo|alterar email|pix|boleto|cart[aã]o de (cr[eé]dito|d[eé]bito))$/i.test(input.message.trim());
    if (state.stage === "checkout" && (browsing || !checkoutAction && !checkoutInput)) {
      state.stage = "store"; state.pendingCoupon = undefined; state.pendingCheckoutEdit = undefined; state.expectsFreeInput = false;
    }
    if (state.stage === "checkout") {
      const sessionId = state.checkoutSessionId || state.conversationId + ":checkout";
      const checkout = await this.sessions.getSession(input.merchantId, sessionId);
      if (!checkout || checkout.merchantId !== input.merchantId) throw new NotFoundException("checkout_session_not_found");
      state = await this.syncPayment(input.merchantId, state);
      const experience = () => buildExperienceFromSession(checkout, { merchantName: config.name, serviceFee: this.experienceConfig?.platformFeeBrl });
      const currentTool = input.action?.kind === "tool" ? input.action.tool : undefined;
      if (currentTool === "show_checkout") return this.checkoutUi({ message: "Confira seu pedido e as opções atuais.", experience: experience(), resumePayment: true }, state, config.name, input.message, input.merchantId);
      if (["cancel_checkout_edit", "cancel_coupon_entry"].includes(currentTool ?? "")) {
        state.pendingCheckoutEdit = undefined; state.pendingCoupon = undefined;
        return this.checkoutUi({ message: "Tudo bem. Seu pedido foi mantido.", experience: experience() }, state, config.name, input.message, input.merchantId);
      }
      if (currentTool === "edit_checkout" || currentTool === "confirm_checkout_edit") {
        if (!verifiedBuyer || !this.reopenCheckout || input.action?.kind !== "tool") throw new ForbiddenException("whatsapp_checkout_edit_buyer_required");
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
          const reopened = await this.reopenCheckout.execute(input.merchantId, sessionId, section, verifiedBuyer);
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
        if (!this.applyCoupon || !verifiedBuyer) throw new ForbiddenException("whatsapp_checkout_coupon_buyer_required");
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
        if (!["payment", "payment_pending"].includes(deriveChatStage(checkout))) return this.checkoutUi({ message: "Confirme os dados e a entrega antes de pagar." }, state, config.name, input.message, input.merchantId);
        if (input.action.args.fingerprint !== paymentCartFingerprint(checkout)) return this.checkoutUi({ message: "O pedido mudou. Confira o resumo atualizado antes de preparar o pagamento." }, state, config.name, input.message, input.merchantId);
        const method = input.action.args.method as "pix" | "card" | "boleto";
        if (state.payment && ["pending", "requires_action"].includes(state.payment.status)) {
          state.pendingCheckoutEdit = { section: "payment", fingerprint: paymentCartFingerprint(checkout), intentId: state.payment.intentId, ...(method === "card" ? { method: "card" } : {}) };
          return this.checkoutUi({ message: "Para trocar a forma de pagamento, precisamos cancelar o pagamento pendente. Confirme a troca para continuar." }, state, config.name, input.message, input.merchantId);
        }
        if (state.payment?.status === "approved") return this.checkoutUi({ message: "O pagamento já foi confirmado. Seu pedido não precisa de outro pagamento." }, state, config.name, input.message, input.merchantId);
        const capabilities = await this.startCheckout?.getPaymentCapabilities?.(input.merchantId);
        if (method === "boleto" || capabilities && !capabilities[method]) return this.checkoutUi({ message: "Essa forma de pagamento não está disponível nesta loja. Escolha uma das opções atuais." }, state, config.name, input.message, input.merchantId);
        // Stripe collects card details in its embedded form on our secure page.
        // Opening it does not change the merchant's selected payment provider.
        if (method === "card" && capabilities?.providers?.card === "stripe") return this.checkoutUi({ message: "*Pagamento seguro com cartão*\n\nAbra o botão abaixo para concluir com o formulário da Stripe. Seu pedido e o frete escolhido serão mantidos.",
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
          return this.checkoutUi({ message: method === "pix" ? "*Pagamento por Pix*\n\nAbra o checkout do provedor ou copie o código abaixo para pagar. A confirmação será automática após a aprovação."
            : "*Pagamento seguro*\n\nAbra o checkout do provedor no botão abaixo para concluir seu pedido.",
            ...(updated ? { experience: buildExperienceFromSession(updated, { merchantName: config.name, serviceFee: payment.amountBreakdown ? payment.amountBreakdown.platformFeeCents / 100 : undefined }) } : {}) }, state, config.name, input.message, input.merchantId);
        } catch (error) {
          if (error instanceof BadGatewayException) {
            const pending = await this.prisma?.paymentIntent.findUnique({ where: { merchantId_sessionId_idempotencyKey: { merchantId: input.merchantId, sessionId, idempotencyKey } }, select: { id: true, status: true, amountCents: true } });
            if (pending) state.payment = { intentId: pending.id, sessionId, method, status: pending.status, amount_cents: pending.amountCents };
            return this.checkoutUi({ message: "Estamos verificando a resposta do provedor. Não faça outro pagamento enquanto essa verificação estiver pendente." }, state, config.name, input.message, input.merchantId);
          }
          if (!(error instanceof BadRequestException || error instanceof ConflictException)) throw error;
          return this.checkoutUi({ message: "Não foi possível preparar o pagamento com os dados atuais. Confira os dados e valores do pedido no checkout seguro antes de continuar.", blocks: [{ type: "hosted_card_payment", data: {} }] }, state, config.name, input.message, input.merchantId);
        }
      }
      const response = await this.chat.execute({ merchant_id: input.merchantId, session_id: sessionId, conversation_id: checkout.conversationId,
        user_message: input.message, message_id: input.messageId ?? randomUUID() });
      return this.checkoutUi(response, state, config.name, input.message, input.merchantId);
    }
    const action = input.action?.kind === "tool" ? input.action : undefined;
    const canonicalAction = action?.tool === "checkout" ? { tool: "create_checkout_session", args: {} } : action ? { tool: action.tool, args: action.args } : undefined;
    const response = await this.store.execute({
      merchant_id: input.merchantId, conversation_id: state.conversationId, cart_id: state.conversationId,
      user_message: input.message, global_user_id: shopper.globalUserId,
      trusted_buyer_context: { globalUserId: shopper.globalUserId, name: shopper.fullName, phone: shopper.phone, email: shopper.email },
      history: state.history, ui_action: canonicalAction,
      attachment_context: input.attachmentContext,
    });
    // A natural-language search with one result should expose its purchase
    // controls immediately. Read through the shared tools without recording a
    // second buyer turn or deriving a variant from the agent's prose.
    if (this.storefrontConversation && !canonicalAction && response.blocks.length &&
      response.blocks.every(block => ["product_carousel", "text", "message"].includes(block.type))) {
      const catalogs = response.blocks.filter(block => block.type === "product_carousel");
      const products = catalogs.flatMap(block => (block.data as any).products ?? []);
      const productId = products[0]?.productId || products[0]?.id;
      if (products.length === 1 && typeof productId === "string" && !catalogs.some(block => (block.data as any).nextCursor)) {
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
        if (!this.startCheckout) throw new Error("whatsapp_checkout_start_unavailable");
        if (!this.cartAuthority) throw new Error("whatsapp_cart_authority_unavailable");
        const cart = await this.cartAuthority.resolveStorefront(input.merchantId, state.conversationId);
        if (state.checkoutSessionId && await this.prisma?.completedOrder.findFirst({ where: { merchantId: input.merchantId, sessionId: state.checkoutSessionId }, select: { id: true } })) state.checkoutGeneration = (state.checkoutGeneration ?? 0) + 1;
        const fingerprint = createHash("sha256").update(JSON.stringify([input.merchantId, state.conversationId, state.checkoutGeneration ?? 0, cart])).digest("hex").slice(0, 32);
        const emailHint = verifiedBuyer?.customer.email ?? await this.checkoutIdentity?.emailHint(input.merchantId, input.buyer);
        const checkoutBuyer = { globalUserId: shopper.globalUserId, phone: shopper.phone, email: emailHint };
        const checkout = await this.startCheckout.execute({
          merchant_id: input.merchantId, session_id: `wa_checkout_${fingerprint}`,
          customer: { phone: checkoutBuyer.phone, email: checkoutBuyer.email },
        } as any, { storefrontCartRef: state.conversationId, ...(verifiedBuyer ? { trustedBuyer: verifiedBuyer } : { trustedPhoneBuyer: checkoutBuyer }) });
        state.stage = "checkout";
        // Synchronize payments created on the secure web surface before
        // resuming. Reopening a link must never cancel or create a charge.
        state.checkoutSessionId = checkout.session_id;
        state = await this.syncPayment(input.merchantId, state);
        let session = await this.sessions.getSession(input.merchantId, checkout.session_id);
        let message: string | undefined;
        if (session?.customer?.email && !session.customer.email_verified && !session.customer.otp_code && this.checkoutCustomer) {
          try { session = await this.checkoutCustomer.beginEmailVerification(session, config.name); }
          catch (error) {
            if (!(error instanceof OtpValidationError)) throw error;
            message = "Não consegui enviar o código por email agora. Escolha *Reenviar código* para tentar novamente.";
          }
        }
        const missing = session ? missingFieldsForStage(session, deriveChatStage(session)) : undefined;
        return await this.checkoutUi({ ...checkout, resumePayment: true, missing_fields: missing, ...(message ? { message } : {}) }, state, config.name, input.message, input.merchantId);
      } catch (error) {
        if (!(error instanceof BadRequestException || error instanceof ConflictException || error instanceof NotFoundException)) throw error;
        const message = "Não consegui preparar a finalização. Confira a disponibilidade dos itens e as condições no carrinho antes de continuar.";
        return { agentMessage: message, quickReplies: ["Ver Carrinho", "Continuar Comprando"], blocks: [], merchantName: config.name,
          state: { ...state, stage: "store", expectsFreeInput: false,
            history: [...state.history, { role: "user" as const, content: input.message }, { role: "assistant" as const, content: message }].slice(-24) } };
      }
    }
    state.history = [...state.history, { role: "user" as const, content: input.message }, { role: "assistant" as const, content: response.message }].slice(-24);
    const product = response.blocks.find(b => b.type === "product_card");
    if (product) {
      const productId = String((product.data as any).id);
      if (state.selectedProductId !== productId) { state.selectedVariantId = undefined; state.selectedOptionItemIds = []; state.selectedOptionGroupId = undefined; state.selectedServiceSlotId = undefined; }
      state.selectedProductId = productId;
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
    return { agentMessage: firstTurn ? `${greeting}\n\n${response.message}` : response.message, quickReplies: response.suggested_next,
      blocks: response.blocks, merchantName: config.name, state };
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
    const exp = response.experience;
    let message = response.message || exp?.agent?.greeting || exp?.copy?.message || "Vamos continuar sua compra.";
    const blocks: WhatsAppStructuredResponse["blocks"] = [];
    for (const block of response.blocks ?? []) {
      if (block.type === "shipping_options" && exp?.shippingOptions?.length) continue;
      if (block.type === "payment_methods") continue;
      blocks.push({ type: block.type, data: block.data ?? {} });
    }
    if (exp?.suggestedProducts?.length) blocks.push({ type: "product_carousel", data: { products: exp.suggestedProducts.map((p: any) => ({ id: p.product_id || p.variant_id, name: p.name, price: p.unit_price, priceFormatted: p.unit_price.toLocaleString("pt-BR", { style: "currency", currency: "BRL" }), image: p.image_url })) } } as any);
    if (exp?.payment_intent && ["created", "pending", "requires_action"].includes(exp.payment_intent.status)) blocks.push({ type: "payment_intent", data: exp.payment_intent });
    let summaryFingerprint = state.checkoutSummaryFingerprint;
    if (exp?.items?.length && (!state.checkoutSessionId || ["payment", "payment_pending", "completed"].includes(exp.stage))) {
      const fingerprint = createHash("sha256").update(JSON.stringify([exp.items, exp.totals, exp.shipping])).digest("hex");
      if (fingerprint !== summaryFingerprint) blocks.push({ type: "checkout_summary", data: { items: exp.items, totals: exp.totals, shippingPending: ["data_collection", "shipping"].includes(exp.stage) && !exp.shipping } });
      summaryFingerprint = fingerprint;
    }
    if (exp?.shippingOptions?.length) blocks.push({ type: "shipping_options", data: { options: exp.shippingOptions.map((o: any) => ({ carrier: o.carrier, name: o.method, price: o.customerPrice, days: o.deliveryDays, responseLabel: checkoutShippingLabel(o) })) } } as any);
    const checkoutSessionId = response.session_id || state.checkoutSessionId;
    const session = checkoutSessionId ? await this.sessions.getSession(merchantId, checkoutSessionId) : undefined;
    if (state.payment && state.payment.sessionId !== checkoutSessionId) state.payment = undefined;
    if (state.payment && this.paymentStatus) {
      const status = await this.paymentStatus.execute({ merchant_id: merchantId, session_id: checkoutSessionId!, intent_id: state.payment.intentId });
      state.payment = { ...state.payment, status: status.status };
      if (status.status === "approved") {
        state.pendingCheckoutEdit = undefined; state.pendingCoupon = undefined;
        const order = await this.prisma?.completedOrder.findFirst({ where: { merchantId, sessionId: checkoutSessionId }, select: { externalOrderId: true, orderTotal: true } });
        message = order ? `Pagamento confirmado! Seu pedido ${order.externalOrderId} está registrado.` : "O pagamento foi confirmado. O registro do pedido está sendo concluído.";
        if (order) blocks.push({ type: "order_confirmation", data: { orderId: order.externalOrderId, total: Number(order.orderTotal), items: exp?.items ?? [] } } as any);
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
        ...(capabilities?.pix ? [{ key: "pix", label: "Pix", sub: "Checkout seguro · pagamento instantâneo" }] : []),
        ...(capabilities?.card ? [{ key: "card", label: "Cartão de crédito", sub: "Checkout seguro do cartão" }] : []),
      ];
      blocks.push({ type: "payment_methods", data: { methods, fingerprint: paymentCartFingerprint(session), nativePayment: true, couponAllowed } });
    } else if (session && state.payment && ["pending", "requires_action"].includes(state.payment.status)) {
      blocks.push({ type: "checkout_edit_actions", data: { fingerprint: paymentCartFingerprint(session), couponAllowed: true } });
    }
    const nextField = response.missing_fields?.[0] ?? (session ? missingFieldsForStage(session, deriveChatStage(session))[0] : undefined);
    // Ask the next field explicitly. Starting a checkout must not stop at its greeting.
    if (nextField === "email") message = "*Vamos finalizar sua compra*\n\nQual é seu email? Vamos enviar um código para confirmar sua conta.\n\n_Seu telefone já foi confirmado pelo WhatsApp._";
    if (nextField === "código de verificação" && session?.customer?.otp_code && !/inválido|expirou|não foi possível|não consegui/i.test(message)) {
      const email = session.customer.email?.replace(/(^.).*(@.*$)/, "$1***$2") || "seu email";
      message = `*Confirme sua conta*\n\nEnviamos um código para *${email}*. Responda aqui com os *6 dígitos*.\n\n_O código vale por 10 minutos. Seus dados salvos serão usados após a confirmação._`;
    }
    if (nextField === "nome") message = "*Seu cadastro*\n\nEmail confirmado. Qual é seu nome completo para o pedido?";
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
      if ((response.initialPaymentMethod === "card" || resumeCard) && state.paymentRevision) widget.searchParams.set("paymentRevision", String(state.paymentRevision));
      const api = process.env.PUBLIC_API_BASE_URL || process.env.API_PUBLIC_URL;
      if (api) widget.searchParams.set("apiBaseUrl", api.endsWith("/v1") ? api : api.replace(/\/$/, "") + "/v1");
      blocks.push({ type: "checkout_redirect", data: { url: widget.href, sessionId: checkoutSessionId } } as any);
    }
    const paymentSurface = blocks.some(block => block.type === "payment_methods") || !!state.payment || !!response.initialPaymentMethod;
    const replies = [...new Set<string>([...(nextField === "código de verificação" || message?.includes("Reenviar código") ? ["Reenviar código", "Alterar email"] : []), ...(exp?.copy?.quick_replies || []), ...(response.actions || []).map((a: any) => a.label)])]
      .filter(label => !paymentSurface || !/^(pix|boleto|cart[aã]o de (cr[eé]dito|d[eé]bito)|remover item|tenho um cupom de desconto)$/i.test(label.trim()));
    return { agentMessage: message, merchantName, blocks,
      quickReplies: secureIdentifier ? ["Ver Carrinho", "Continuar Comprando"] : state.pendingCheckoutEdit || state.pendingCoupon ? [] : paymentSurface ? [...replies, ...(state.payment ? ["Verificar pagamento"] : []), "Ver Carrinho", "Continuar Comprando"] : replies,
      state: { ...state, checkoutSessionId: response.session_id || state.checkoutSessionId, checkoutConversationId: response.conversation_id || state.checkoutConversationId,
        checkoutSummaryFingerprint: summaryFingerprint,
        pendingFlow, expectsFreeInput: !!state.pendingCoupon || !secureIdentifier && !!nextField && /^(telefone|email|nome|CPF|CEP|número|complemento|código de verificação)/i.test(nextField),
        history: [...state.history, { role: "user" as const, content: userMessage }, { role: "assistant" as const, content: message }].slice(-24) } };
  }
}
