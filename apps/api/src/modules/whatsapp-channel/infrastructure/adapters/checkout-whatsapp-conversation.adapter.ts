import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException, Optional } from "@nestjs/common";
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
    const greeting = config.agentGreeting || `Oi! Sou ${config.agentName || "Zyon"}, sua vendedora pessoal aqui na ${config.name}. 💚 Me conta o que você procura — eu encontro o produto ideal, garanto o melhor preço com cupons, calculo o frete e fecho seu pedido em segundos, tudo por aqui. Bora começar?`;
    state.pendingFlow = undefined;
    if ((firstTurn && /^(oi|ol[áa]|bom dia|boa tarde|boa noite)[!.\s]*$/i.test(input.message.trim())) || /^(menu|in[ií]cio)[!.\s]*$/i.test(input.message.trim())) {
      state.stage = "store"; state.expectsFreeInput = false;
      state.history = [{ role: "user", content: input.message }, { role: "assistant", content: greeting }];
      return { agentMessage: greeting, quickReplies: config.quickReplies || [], blocks: [], merchantName: config.name, state };
    }
    const paymentAction = input.action?.kind === "tool" && input.action.tool === "create_payment";
    const browsing = (input.action?.kind === "tool" && !paymentAction) || /^(continuar comprando|ver produtos|encontrar produto|categorias|ofertas|ver carrinho)$/i.test(input.message.trim());
    if (state.stage === "checkout" && browsing) state.stage = "store";
    if (state.stage === "checkout") {
      const sessionId = state.checkoutSessionId || state.conversationId + ":checkout";
      const checkout = await this.sessions.getSession(input.merchantId, sessionId);
      if (!checkout || checkout.merchantId !== input.merchantId) throw new NotFoundException("checkout_session_not_found");
      const missing = missingFieldsForStage(checkout, deriveChatStage(checkout));
      if (missing[0] === "CPF") {
        // Meta prohibits requesting full personal identifiers in WhatsApp. The
        // same checkout continues in the signed web surface for this field.
        return this.checkoutUi({ session_id: checkout.sessionId, conversation_id: checkout.conversationId, missing_fields: missing,
          message: "Para proteger seus dados, preencha seu CPF no checkout seguro. Depois, você pode continuar por aqui.", actions: [] },
          state, config.name, "Continuar no checkout seguro", input.merchantId);
      }
      if (paymentAction) {
        if (!this.createPayment || input.action?.kind !== "tool" || input.action.args.method !== "pix") throw new Error("whatsapp_payment_action_unavailable");
        if (input.action.args.fingerprint !== paymentCartFingerprint(checkout)) return this.checkoutUi({ message: "O pedido mudou. Confira o resumo atualizado antes de gerar o Pix." }, state, config.name, input.message, input.merchantId);
        try {
          const payment = await this.createPayment.execute({ merchant_id: input.merchantId, session_id: sessionId, method: "pix",
            idempotency_key: "wa_pix_" + createHash("sha256").update(`${sessionId}:${paymentCartFingerprint(checkout)}`).digest("hex") }, { marketplaceSurface: "v1" });
          state.payment = { intentId: payment.id, sessionId, status: payment.status, amount_cents: payment.amountCents,
            copy_paste: payment.buyerFacing?.qrCodeCopyPaste, ticket_url: payment.buyerFacing?.invoiceUrl };
          return this.checkoutUi({ message: "Use o Pix abaixo para pagar. A confirmação depende do banco; você pode pedir para verificar o pagamento." }, state, config.name, input.message, input.merchantId);
        } catch (error) {
          if (!(error instanceof BadRequestException || error instanceof ConflictException)) throw error;
          return this.checkoutUi({ message: "Não foi possível gerar o Pix com os dados atuais. Confira os dados e valores do pedido no checkout seguro antes de continuar." }, state, config.name, input.message, input.merchantId);
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
        let session = await this.sessions.getSession(input.merchantId, checkout.session_id);
        let message: string | undefined;
        if (session?.customer?.email && !session.customer.email_verified && !session.customer.otp_code && this.checkoutCustomer) {
          try { session = await this.checkoutCustomer.processCustomerInput(session, "Iniciar cadastro", undefined, config.name); }
          catch (error) {
            if (!(error instanceof OtpValidationError)) throw error;
            message = "Não consegui enviar o código por email agora. Escolha *Reenviar código* para tentar novamente.";
          }
        }
        const missing = session ? missingFieldsForStage(session, deriveChatStage(session)) : undefined;
        return await this.checkoutUi({ ...checkout, missing_fields: missing, ...(message ? { message } : {}) }, state, config.name, input.message, input.merchantId);
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

  private async checkoutUi(response: any, state: WhatsAppConversationState, merchantName: string, userMessage: string, merchantId: string): Promise<WhatsAppStructuredResponse> {
    const exp = response.experience;
    let message = response.message || exp?.agent?.greeting || exp?.copy?.message || "Vamos continuar sua compra.";
    const blocks: WhatsAppStructuredResponse["blocks"] = [];
    for (const block of response.blocks ?? []) {
      if (block.type === "shipping_options" && exp?.shippingOptions?.length) continue;
      blocks.push({ type: block.type, data: block.data ?? {} });
    }
    if (exp?.suggestedProducts?.length) blocks.push({ type: "product_carousel", data: { products: exp.suggestedProducts.map((p: any) => ({ id: p.product_id || p.variant_id, name: p.name, price: p.unit_price, priceFormatted: p.unit_price.toLocaleString("pt-BR", { style: "currency", currency: "BRL" }), image: p.image_url })) } } as any);
    if (exp?.payment_intent && ["created", "pending", "requires_action"].includes(exp.payment_intent.status)) blocks.push({ type: "payment_intent", data: exp.payment_intent });
    if (exp?.items?.length && (!state.checkoutSessionId || ["payment", "payment_pending", "completed"].includes(exp.stage))) blocks.push({ type: "checkout_summary", data: { items: exp.items, totals: exp.totals, shippingPending: ["data_collection", "shipping"].includes(exp.stage) && !exp.shipping } });
    if (exp?.shippingOptions?.length) blocks.push({ type: "shipping_options", data: { options: exp.shippingOptions.map((o: any, index: number) => ({ carrier: o.carrier, name: o.method, price: o.customerPrice, days: o.deliveryDays, responseLabel: exp.copy.quick_replies?.[index] })) } } as any);
    const checkoutSessionId = response.session_id || state.checkoutSessionId;
    const session = checkoutSessionId ? await this.sessions.getSession(merchantId, checkoutSessionId) : undefined;
    if (state.payment && state.payment.sessionId !== checkoutSessionId) state.payment = undefined;
    if (state.payment && this.paymentStatus) {
      const status = await this.paymentStatus.execute({ merchant_id: merchantId, session_id: checkoutSessionId!, intent_id: state.payment.intentId });
      state.payment = { ...state.payment, status: status.status };
      if (status.status === "approved") {
        const order = await this.prisma?.completedOrder.findFirst({ where: { merchantId, sessionId: checkoutSessionId }, select: { externalOrderId: true, orderTotal: true } });
        message = order ? `Pagamento confirmado! Seu pedido ${order.externalOrderId} está registrado.` : "O pagamento foi confirmado. O registro do pedido está sendo concluído.";
        if (order) blocks.push({ type: "order_confirmation", data: { orderId: order.externalOrderId, total: Number(order.orderTotal), items: exp?.items ?? [] } } as any);
      } else if (["pending", "requires_action"].includes(status.status)) blocks.push({ type: "payment_intent", data: state.payment });
      else message = "Esse pagamento não está mais disponível. Confira o estado do pedido no checkout seguro.";
    }
    if (session?.paymentMethod === "pix" && !state.payment && ["payment", "payment_pending"].includes(deriveChatStage(session))) blocks.push({ type: "payment_actions", data: { fingerprint: paymentCartFingerprint(session) } });
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
    const needsSecureCheckout = secureIdentifier || blocks.some(block => ["stripe_card", "hosted_card_payment", "crypto_payment"].includes(block.type));
    if (needsSecureCheckout && checkoutSessionId && this.embedTokens && process.env.WIDGET_BASE_URL) {
      const widget = new URL(process.env.WIDGET_BASE_URL);
      if (widget.protocol !== "https:" && !["localhost", "127.0.0.1"].includes(widget.hostname)) throw new Error("whatsapp_checkout_origin_invalid");
      const now = Math.floor(Date.now() / 1000);
      const token = this.embedTokens.sign({ typ: "aacp_embed_v1", merchantId, issuedAtUnix: now, expiresAtUnix: now + 900,
        nonce: randomUUID(), allowedOrigin: widget.origin, storefrontCartRef: state.conversationId, whatsappCheckoutSessionId: checkoutSessionId,
        scopes: ["checkout:start", "checkout:track", "checkout:chat", "payment:intents:create", "payment:intents:read", "payment:intents:confirm", "offers:apply", "coupons:apply"] });
      widget.searchParams.set("embedToken", token); widget.searchParams.set("merchantId", merchantId);
      widget.searchParams.set("channel", "chat");
      const api = process.env.PUBLIC_API_BASE_URL || process.env.API_PUBLIC_URL;
      if (api) widget.searchParams.set("apiBaseUrl", api.endsWith("/v1") ? api : api.replace(/\/$/, "") + "/v1");
      blocks.push({ type: "checkout_redirect", data: { url: widget.href, sessionId: checkoutSessionId } } as any);
    }
    return { agentMessage: message, merchantName, blocks,
      quickReplies: secureIdentifier ? ["Ver Carrinho", "Continuar Comprando"] : [...new Set<string>([...(nextField === "código de verificação" || message?.includes("Reenviar código") ? ["Reenviar código", "Alterar email"] : []), ...(exp?.copy?.quick_replies || []), ...(response.actions || []).map((a: any) => a.label)])],
      state: { ...state, checkoutSessionId: response.session_id || state.checkoutSessionId, checkoutConversationId: response.conversation_id || state.checkoutConversationId,
        pendingFlow, expectsFreeInput: !secureIdentifier && !!nextField && /^(telefone|email|nome|CPF|CEP|número|complemento|código de verificação)/i.test(nextField),
        history: [...state.history, { role: "user" as const, content: userMessage }, { role: "assistant" as const, content: message }].slice(-24) } };
  }
}
