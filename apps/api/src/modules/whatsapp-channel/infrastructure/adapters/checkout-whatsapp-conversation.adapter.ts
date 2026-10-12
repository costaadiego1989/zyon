import { Inject, Injectable, NotFoundException, Optional } from "@nestjs/common";
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
  }): Promise<WhatsAppStructuredResponse> {
    if (!this.store || !this.storeConfig) throw new Error("whatsapp_storefront_adapter_unavailable");
    const config = await this.storeConfig.execute(input.merchantId);
    let state = { ...input.state };
    const firstTurn = state.history.length === 0;
    const greeting = config.agentGreeting || `Oi! Sou ${config.agentName || "Zyon"}, sua assistente de compras na ${config.name}. O que você procura hoje?`;
    if (firstTurn && /^(oi|ol[áa]|bom dia|boa tarde|boa noite|menu|in[ií]cio)[!.\s]*$/i.test(input.message.trim())) {
      state.history = [{ role: "user", content: input.message }, { role: "assistant", content: greeting }];
      return { agentMessage: greeting, quickReplies: config.quickReplies || [], blocks: [], merchantName: config.name, state };
    }
    const browsing = input.action?.kind === "tool" || /^(continuar comprando|ver produtos|encontrar produto|categorias|ofertas|ver carrinho)$/i.test(input.message.trim());
    if (state.stage === "checkout" && browsing) state.stage = "store";
    if (state.stage === "checkout") {
      const sessionId = state.checkoutSessionId || state.conversationId + ":checkout";
      const checkout = await this.sessions.getSession(input.merchantId, sessionId);
      if (!checkout || checkout.merchantId !== input.merchantId) throw new NotFoundException("checkout_session_not_found");
      const response = await this.chat.execute({ merchant_id: input.merchantId, session_id: sessionId, conversation_id: checkout.conversationId, user_message: input.message });
      return this.checkoutUi(response, state, config.name, input.message, input.merchantId);
    }
    const action = input.action?.kind === "tool" ? input.action : undefined;
    const canonicalAction = action?.tool === "checkout" ? { tool: "create_checkout_session", args: {} } : action ? { tool: action.tool, args: action.args } : undefined;
    const response = await this.store.execute({
      merchant_id: input.merchantId, conversation_id: state.conversationId, cart_id: state.conversationId,
      user_message: input.message, global_user_id: input.buyer.globalUserId,
      trusted_buyer_context: { globalUserId: input.buyer.globalUserId, name: input.buyer.fullName, phone: input.buyer.phone, email: input.buyer.email },
      history: state.history, ui_action: canonicalAction,
    });
    if (response.blocks.some(b => ["checkout_prepared", "checkout_redirect"].includes(b.type))) {
      if (!this.startCheckout) throw new Error("whatsapp_checkout_start_unavailable");
      if (!this.cartAuthority) throw new Error("whatsapp_cart_authority_unavailable");
      const cart = await this.cartAuthority.resolveStorefront(input.merchantId, state.conversationId);
      const fingerprint = createHash("sha256").update(JSON.stringify([input.merchantId, state.conversationId, cart])).digest("hex").slice(0, 32);
      const checkout = await this.startCheckout.execute({
        merchant_id: input.merchantId, session_id: `wa_checkout_${fingerprint}`,
        customer: { phone: input.buyer.phone, fullName: input.buyer.fullName, email: input.buyer.email },
      } as any, { storefrontCartRef: state.conversationId, trustedPhoneBuyer: input.buyer });
      state.stage = "checkout";
      return this.checkoutUi(checkout, state, config.name, input.message, input.merchantId);
    }
    state.history = [...state.history, { role: "user" as const, content: input.message }, { role: "assistant" as const, content: response.message }].slice(-24);
    const product = response.blocks.find(b => b.type === "product_card");
    if (product) {
      const productId = String((product.data as any).id);
      if (state.selectedProductId !== productId) { state.selectedVariantId = undefined; state.selectedOptionItemIds = []; }
      state.selectedProductId = productId;
      if (this.productContent) {
        const content = await this.productContent.execute({ merchantId: input.merchantId, productId });
        const contentBlocks = content.blocks.map(block => ({ ...block.props, type: block.type, order: block.order }));
        if (content.faqs.length) contentBlocks.push({ type: "faq", order: contentBlocks.length, items: content.faqs } as any);
        if (contentBlocks.length) response.blocks.push({ type: "product_content", data: { productId, blocks: contentBlocks } } as any);
      }
    }
    return { agentMessage: firstTurn ? `${greeting}\n\n${response.message}` : response.message, quickReplies: response.suggested_next,
      blocks: response.blocks, merchantName: config.name, state };
  }

  private checkoutUi(response: any, state: WhatsAppConversationState, merchantName: string, userMessage: string, merchantId: string): WhatsAppStructuredResponse {
    const exp = response.experience;
    const message = response.message || exp?.copy?.message || exp?.copy?.headline || "Vamos continuar sua compra.";
    const blocks: WhatsAppStructuredResponse["blocks"] = [];
    if (exp?.suggestedProducts?.length) blocks.push({ type: "product_carousel", data: { products: exp.suggestedProducts.map((p: any) => ({ id: p.product_id || p.variant_id, name: p.name, price: p.unit_price, priceFormatted: p.unit_price.toLocaleString("pt-BR", { style: "currency", currency: "BRL" }), image: p.image_url })) } } as any);
    if (exp?.payment_intent && ["created", "pending", "requires_action"].includes(exp.payment_intent.status)) blocks.push({ type: "payment_intent", data: exp.payment_intent });
    if (exp?.items?.length) blocks.push({ type: "checkout_summary", data: { items: exp.items, totals: exp.totals } });
    if (exp?.shippingOptions?.length) blocks.push({ type: "shipping_options", data: { options: exp.shippingOptions.map((o: any) => ({ carrier: o.carrier, name: o.service || o.name, price: o.price, days: o.estimatedDays || o.days })) } } as any);
    const checkoutSessionId = response.session_id || state.checkoutSessionId;
    if (checkoutSessionId && this.embedTokens && process.env.WIDGET_BASE_URL) {
      const widget = new URL(process.env.WIDGET_BASE_URL);
      if (widget.protocol !== "https:" && !["localhost", "127.0.0.1"].includes(widget.hostname)) throw new Error("whatsapp_checkout_origin_invalid");
      const now = Math.floor(Date.now() / 1000);
      const token = this.embedTokens.sign({ typ: "aacp_embed_v1", merchantId, issuedAtUnix: now, expiresAtUnix: now + 900,
        nonce: randomUUID(), allowedOrigin: widget.origin, storefrontCartRef: state.conversationId, whatsappCheckoutSessionId: checkoutSessionId,
        scopes: ["checkout:start", "checkout:track", "checkout:chat", "payment:intents:create", "payment:intents:read", "payment:intents:confirm", "offers:apply", "coupons:apply"] });
      widget.searchParams.set("embedToken", token); widget.searchParams.set("merchantId", merchantId);
      const api = process.env.PUBLIC_API_BASE_URL || process.env.API_PUBLIC_URL;
      if (api) widget.searchParams.set("apiBaseUrl", api.endsWith("/v1") ? api : api.replace(/\/$/, "") + "/v1");
      blocks.push({ type: "checkout_redirect", data: { url: widget.href, sessionId: checkoutSessionId } } as any);
    }
    return { agentMessage: message, merchantName, blocks,
      quickReplies: [...new Set<string>([...(exp?.copy?.quick_replies || []), ...(response.actions || []).map((a: any) => a.label)])],
      state: { ...state, checkoutSessionId: response.session_id || state.checkoutSessionId, checkoutConversationId: response.conversation_id || state.checkoutConversationId,
        expectsFreeInput: exp?.copy?.focus_input === true,
        history: [...state.history, { role: "user" as const, content: userMessage }, { role: "assistant" as const, content: message }].slice(-24) } };
  }
}
