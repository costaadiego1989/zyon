import { MARKETING_RELATIONSHIP, MERCHANT_MARKETING_MESSAGING, MARKETING_CONSENT_TEXT,
  type MarketingRelationshipPort, type MerchantMarketingMessaging, type MarketingInboundDecision } from "../../../../shared/contracts/marketing.js";
import { conversationHistoryText } from "../../../../shared/privacy/conversation-history-text.js";
import { Inject, Injectable, Optional } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { WHATSAPP_CONVERSATION_PORT, type WhatsAppConversationPort } from "../../domain/ports/whatsapp-conversation.port.js";
import { WHATSAPP_SESSION_REPOSITORY, type WhatsAppSessionRepository } from "../../domain/ports/whatsapp-session-repository.port.js";
import { WHATSAPP_WEBHOOK_INBOX, type WhatsAppWebhookInbox, type WhatsAppInboxClaim } from "../../domain/ports/whatsapp-webhook-inbox.port.js";
import { buildMetaUiView, presentMetaUi, withMetaCartNavigation, isMetaCatalogView } from "../../domain/ui/meta-ui-renderer.js";
import type { MetaUiPresentation, MetaUiView, StoreUiAction, WhatsAppConversationState, WhatsAppStructuredResponse } from "../../domain/ui/meta-ui.types.js";
import { SendWhatsAppResponseUseCase } from "./send-whatsapp-response.use-case.js";
import type { IncomingMessageInput } from "./handle-incoming-message.use-case.js";
import type { RouteResult } from "./route-to-session.use-case.js";
import { MetaUiCapabilitiesAdapter } from "../../infrastructure/adapters/meta-ui-capabilities.adapter.js";
import { resolveMetaFieldFlow } from "../../domain/ui/meta-flow.js";
import { MetaInboundMediaAdapter } from "../../infrastructure/adapters/meta-inbound-media.adapter.js";
import { MetaCatalogOrderAdapter } from "../../infrastructure/adapters/meta-catalog-order.adapter.js";
import { metaStoreQuickReplyAction, resolveMetaStoreTextAction } from "../../domain/ui/meta-store-actions.js";
import { isMetaReadNavigation, refreshMetaReadView } from "../../domain/ui/meta-read-navigation.js";
import { metaProductContext, withMetaProductNavigation } from "../../domain/ui/meta-product-navigation.js";
import { recoverMetaPaymentChoice } from "../../domain/ui/meta-payment-selection.js";
import { BuyerInboundWhatsAppLinkUseCase } from "../../../buyer-account/application/use-cases/buyer-inbound-whatsapp-link.use-case.js";

interface SavedTurn { marketingConversationId?: string; marketingResponseKey?: string; dispatchAttempts?: number; phase: "generating" | "prepared" | "dispatching" | "complete"; presentation?: MetaUiPresentation; state?: WhatsAppConversationState; sessionId?: string; previousRevision?: string; sessionApplied?: boolean; sent?: Array<{ index: number; messageId: string }>; dispatchingIndex?: number }

/** Match the exact durable authenticated envelope before paying for media or
 * granting current-speech authority. MIME alone is never provenance. */
function matchesMetaMediaEnvelope(input: IncomingMessageInput, claim: WhatsAppInboxClaim): boolean {
  if (!input.metaMedia || input.provider !== "META_CLOUD" || !input.deviceId.startsWith("META_CLOUD:") || input.deviceId.length <= 11
    || claim.kind !== "message" || claim.merchantId !== input.merchantId || claim.deviceId !== input.deviceId
    || claim.configId !== input.deviceId.slice(11) || typeof claim.leaseToken !== "string" || !claim.leaseToken.trim()) return false;
  const payload = claim.payload;
  if (!payload || typeof payload !== "object" || !("fromNumber" in payload) || payload.ignored === true) return false;
  const { inboxClaim: _inboxClaim, ...candidate } = input;
  return isDeepStrictEqual(payload, candidate);
}

/** Only an isolated choice in a current menu can become a spoken index.
 * Product quantities, names and free-entry fields retain their original text. */
function isolatedMenuChoice(message: string, state: WhatsAppConversationState): number | undefined {
  if (state.expectsFreeInput || !state.view || !state.numericSelections?.length) return undefined;
  const normalized = message.normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toLowerCase();
  const match = /^(?:(?:quero a )?opcao )?(um|uma|dois|duas|tres|quatro|cinco|seis|sete|oito|nove|dez|\d{1,2})[.!?]?$/.exec(normalized);
  if (!match) return undefined;
  const words: Record<string, number> = { um: 1, uma: 1, dois: 2, duas: 2, tres: 3, quatro: 4, cinco: 5, seis: 6, sete: 7, oito: 8, nove: 9, dez: 10 };
  const index = words[match[1]!] ?? Number(match[1]);
  return index >= 1 && index <= state.numericSelections.length ? index : undefined;
}

@Injectable()
export class HandleMetaConversationUseCase {
  constructor(
    @Inject(WHATSAPP_CONVERSATION_PORT) private readonly conversation: WhatsAppConversationPort,
    @Inject(WHATSAPP_SESSION_REPOSITORY) private readonly sessions: WhatsAppSessionRepository,
    @Inject(WHATSAPP_WEBHOOK_INBOX) private readonly inbox: WhatsAppWebhookInbox,
    private readonly sender: SendWhatsAppResponseUseCase,
    @Optional() private readonly capabilities?: MetaUiCapabilitiesAdapter,
    @Optional() private readonly inboundMedia?: MetaInboundMediaAdapter,
    @Optional() private readonly catalogOrders?: MetaCatalogOrderAdapter,
    @Optional() private readonly accountLinks?: BuyerInboundWhatsAppLinkUseCase,
    @Optional() @Inject(MARKETING_RELATIONSHIP) private readonly marketing?: MarketingRelationshipPort,
    @Optional() @Inject(MERCHANT_MARKETING_MESSAGING) private readonly marketingMessaging?: MerchantMarketingMessaging,
  ) {}

  async execute(input: IncomingMessageInput, route: RouteResult, responseProducer?: (message: string) => Promise<WhatsAppStructuredResponse>): Promise<void> {
    if (Date.now() - input.timestamp > 24 * 60 * 60 * 1000) throw new Error("whatsapp_service_window_expired");
    const claim = input.inboxClaim;
    if (!claim || !this.inbox.saveResponse || !this.conversation.respondStore) throw new Error("whatsapp_durable_ui_unavailable");
    const verifiedSender = input.provider === "META_CLOUD" ? { inboxId: claim.id, leaseToken: claim.leaseToken,
      deviceId: input.deviceId, fromNumber: input.fromNumber } : undefined;
    let saved = claim.responseState as unknown as SavedTurn | undefined;
    if (saved?.phase === "generating" || saved?.phase === "dispatching") throw new Error("whatsapp_turn_result_unknown");
    if (saved?.phase === "complete") return;
    if (!saved?.presentation || !saved.state) {
      await this.save(claim, {phase:"generating"});
      let state: WhatsAppConversationState = route.whatsappSession.conversationState ?? { version: 1, conversationId: randomUUID(), stage: "store", history: [], revision: "", page: 0, previousViews: [] };
      if (this.capabilities) state = { ...state, ...await this.capabilities.get(input.merchantId, input.deviceId) };
      const mediaScopeValid = matchesMetaMediaEnvelope(input, claim);
      const interpreted = !responseProducer && input.metaMedia && mediaScopeValid ? await this.inboundMedia?.interpret(input.merchantId, input.deviceId, input.metaMedia,
        { inboxId: claim.id, conversationId: state.conversationId }) : undefined;
      // Only the internal typed result, bound to this exact authenticated turn,
      // supplies current speech. Raw inbox input/IDs are never overwritten.
      const spokenMessage = interpreted?.kind === "audio_transcript" && mediaScopeValid && interpreted.scope?.merchantId === input.merchantId
        && interpreted.scope.deviceId === input.deviceId && interpreted.scope.inboxId === claim.id
        && interpreted.scope.conversationId === state.conversationId && interpreted.scope.mediaId === input.metaMedia?.id
        && typeof interpreted.text === "string" && interpreted.text.trim().length > 0 && interpreted.text.length <= 4000
        ? interpreted.text : undefined;
      let attachmentContext = interpreted?.kind === "attachment_context" && typeof interpreted.context === "string" && interpreted.context.trim()
        ? interpreted.context : undefined;
      const unreadMedia = !!input.metaMedia && !spokenMessage && !attachmentContext;
      let message = spokenMessage ?? input.body;
      let relationship: MarketingInboundDecision | undefined;
      if (this.marketing && await this.marketing.enabled(input.merchantId)) {
        const conversationKey = route.whatsappSession.conversationState?.conversationId ?? route.whatsappSession.checkoutSessionId ?? state.conversationId;
        relationship = await this.marketing.inbound({merchantId:input.merchantId, channel:"whatsapp", conversationKey,
          messageId:input.providerMessageId ?? claim.eventId, text:conversationHistoryText(message,8000),
          verifiedPhone:input.fromNumber, deviceId:input.deviceId,
          receivedAt:new Date(input.providerTimestampVerified ? input.timestamp : Date.now()).toISOString()});
        if (relationship.human) {await this.save(claim,{phase:"complete"});return;}
        if (relationship.openingRequired) {
          if (!this.marketingMessaging) throw new Error("whatsapp_marketing_transport_unavailable");
          if (attachmentContext) {
            state={...state,marketingPendingAttachment:attachmentContext.slice(0,24000)};
            await this.sessions.update(route.whatsappSession.id,{conversationState:state});
          }
          await this.marketing.opening(input.merchantId,relationship.conversationId,async()=>{
            await this.save(claim,{phase:"dispatching"});
            return this.marketingMessaging!.sendOpening({
              merchantId:input.merchantId, phone:input.fromNumber, deviceId:input.deviceId, text:MARKETING_CONSENT_TEXT});
          });
          await this.save(claim,{phase:"complete"});
          return;
        }
        if (relationship.optedOut) {
          if (!this.marketingMessaging) throw new Error("whatsapp_marketing_transport_unavailable");
          await this.marketing.aiReply(input.merchantId,relationship.conversationId,claim.eventId,
            "Você não receberá mais promoções desta loja. Seu atendimento continua disponível.",
            async()=>{
              await this.save(claim,{phase:"dispatching"});
              const result=await this.marketingMessaging!.sendFreeform({merchantId:input.merchantId,phone:input.fromNumber,deviceId:input.deviceId,
              text:"Você não receberá mais promoções desta loja. Seu atendimento continua disponível."});return {...result,status:result.status === "suppressed" ? "failed" as const : result.status};});
          await this.save(claim,{phase:"complete"});
          return;
        }
        if (relationship.originalQuestion !== message && state.marketingPendingAttachment) attachmentContext=state.marketingPendingAttachment;
        state={...state,marketingPendingAttachment:undefined};
        message=relationship.originalQuestion;
        const transcript=await this.marketing.history(input.merchantId,"whatsapp",conversationKey);
        if (transcript?.some(m=>m.role === "agent")) state={...state,history:transcript
          .filter(m=>m.role !== "system" && ["recorded","accepted","delivered","read"].includes(m.status))
          .slice(0,-1).slice(-20)
          .map(m=>({role:m.role === "buyer" ? "user" as const : "assistant" as const,content:m.content}))};
      }
      let action: StoreUiAction | undefined;
      let recoveredView: MetaUiView | undefined;
      const numeric = /^\d{1,2}$/.test(message.trim()) ? Number(message.trim()) : isolatedMenuChoice(message, state) ?? NaN;
      let invalidSelection = false;
      if (responseProducer) { /* The post-sale handler owns its numeric input. */ }
      else if (input.metaMedia && !spokenMessage) { /* Reference/failed media never selects or authorizes a UI action. */ }
      else if (input.catalogOrder) {
        const lines = await this.catalogOrders?.resolve(input.merchantId, state.catalogId, input.catalogOrder);
        invalidSelection = !lines;
        if (lines) action = { kind: "tool", tool: "add_catalog_items", args: { lines } };
      } else if (input.flowResponse) {
        const message = resolveMetaFieldFlow(state, input.flowResponse);
        invalidSelection = !message;
        if (message) { action = { kind: "message", message }; state = { ...state, pendingFlow: undefined }; }
      } else if (input.interactiveId && !input.interactiveId.startsWith("marketing_")) {
        action = state.selections?.[input.interactiveId];
        if (!action) {
          const previous = await this.inbox.findPriorSelection?.(claim, route.whatsappSession.id, input.interactiveId);
          if (previous) action = recoverMetaPaymentChoice(previous, state);
          if (previous && isMetaReadNavigation(previous.action)) {
            action = previous.action;
            // Previously sent catalog controls now open the same current hub.
            if (action.kind === "catalog_options" || action.kind === "menu" && isMetaCatalogView(previous.view)) action = { kind: "message", message: "/atalhos" };
            if (action.kind === "page") { recoveredView = previous.view; if (!recoveredView) action = { kind: "menu" }; }
            else if (action.kind === "back" && previous.previousView) {
              recoveredView = previous.previousView; action = { kind: "page", page: 0 };
            } else if (action.kind === "back") action = { kind: "menu" };
          }
        }
        invalidSelection = !action;
      } else if (!state.expectsFreeInput && /^(0|voltar)$/i.test(message.trim()) && state.previousViews.length) action = { kind: "back" };
      else if (!state.expectsFreeInput && numeric >= 1 && numeric <= (state.numericSelections?.length ?? 0)) action = state.numericSelections?.[numeric - 1];
      else if (/^(menu|in[ií]cio)$/i.test(message.trim())) action = { kind: "menu" };
      else if (!input.metaMedia || spokenMessage) action = resolveMetaStoreTextAction(message, state);
      if (action?.kind === "catalog_options" || action?.kind === "menu" && !recoveredView && isMetaCatalogView(state.view) &&
        (input.interactiveId || !state.expectsFreeInput && numeric >= 1 && numeric <= (state.numericSelections?.length ?? 0))) action = { kind: "message", message: "/atalhos" };
      if (action?.kind === "message" && /^(ver carrinho|finalizar compra|finalizar pedido|continuar checkout|continuar comprando|ver produtos)$/i.test(action.message.trim())) action = metaStoreQuickReplyAction(action.message, state) ?? action;

      const revision = claim.id;
      let view: MetaUiView | undefined = state.view ? { ...state.view, stage: state.view.stage ?? state.stage } : undefined;
      if (recoveredView) {
        const refresh = refreshMetaReadView(recoveredView);
        if (refresh) {
          const response = await this.conversation.respondStore({ verifiedSender, merchantId: input.merchantId, buyer: route.buyerData,
            message: refresh.kind === "message" ? refresh.message : "Continuar navegação", state, action: refresh });
          state = response.state; view = buildMetaUiView(response);
        } else view = recoveredView;
      }
      let includeMedia = true;
      let navigationOnly = false;
      const accountLink = await this.accountLinks?.handle(input, state);
      if (accountLink) { state = accountLink.state; view = buildMetaUiView(accountLink); includeMedia = false; }
      else if (invalidSelection) { view = { ...(view ?? { title: "Sua loja", choices: [{ label: "Menu", action: { kind: "menu" } }], media: [], blocks: [], quickReplies: [] }), body: "Esse menu foi atualizado. Use as opções abaixo ou escreva o que você quer fazer." }; includeMedia = false; }
      else if (action?.kind === "page" && view) {
        state = { ...state, page: action.page };
        // A current menu page only changes the controls. Archived navigation
        // reloads authoritative data and must still present that fresh content.
        navigationOnly = !recoveredView;
      }
      else if (action?.kind === "cart_edit_items") {
        const response = await this.conversation.respondStore({ verifiedSender, merchantId: input.merchantId, buyer: route.buyerData,
          message: "Editar itens do carrinho", state, action: { kind: "tool", tool: "get_cart", args: {} } });
        state = { ...response.state, page: 0 }; view = buildMetaUiView(response, { cartEditing: true });
      }
      else if (action?.kind === "back" && state.previousViews.length) {
        view = state.previousViews.at(-1); state = { ...state, page: 0, previousViews: state.previousViews.slice(0, -1) };
        const product = view?.blocks.find(b => b.type === "product_card");
        const cartView = view?.blocks.some(b => b.type === "cart_summary") || view?.choices.some(c => c.action.kind === "tool" && ["update_cart_item", "remove_cart_item", "edit_cart_item"].includes(c.action.tool));
        const checkoutView = !!state.checkoutSessionId && (view?.stage === "checkout" || !view?.stage && view?.blocks.some(b => ["checkout_summary", "payment_methods", "payment_intent", "checkout_edit_actions", "checkout_edit_confirmation", "coupon_entry", "checkout_redirect", "checkout_form", "shipping_options"].includes(b.type)));
        state = { ...state, stage: checkoutView ? "checkout" : view?.stage ?? (cartView || product ? "store" : state.stage),
          pendingCheckoutEdit: undefined, pendingCoupon: undefined, pendingFlow: undefined, pendingProductQuestion: undefined, expectsFreeInput: false };
        const refresh = view?.blocks.some(block => block.type === "buyer_hub_actions") ? { kind: "message" as const, message: "/atalhos" }
          : checkoutView ? { kind: "tool" as const, tool: "show_checkout", args: {} } : cartView ? { kind: "tool" as const, tool: "get_cart", args: {} }
          : product ? { kind: "tool" as const, tool: "get_product_details", args: { productId: (product.data as any).id } } : undefined;
        if (refresh) { const response = await this.conversation.respondStore({ verifiedSender, merchantId: input.merchantId, buyer: route.buyerData, message: refresh.kind === "message" ? refresh.message : "Voltar", state, action: refresh }); state = response.state; view = buildMetaUiView(response); }
      }
      else if ((action?.kind === "variant" || action?.kind === "option" || action?.kind === "slot" || action?.kind === "option_group") && view) {
        let selectedOptionItemIds = state.selectedOptionItemIds;
        if (action.kind === "option") {
          const selectedAction = action;
          const product = view.blocks.find(b => b.type === "product_card" && (b.data as any).id === selectedAction.productId);
          const group = (product?.data as any)?.optionGroups?.find((g: any) => g.id === selectedAction.groupId);
          const groupIds = new Set<string>(group?.items?.map((i: any) => i.id) ?? []);
          const chosen = state.selectedOptionItemIds ?? [];
          selectedOptionItemIds = group?.selectionType === "single" ? [...chosen.filter(id => !groupIds.has(id)), action.itemId]
            : chosen.includes(action.itemId) ? chosen.filter(id => id !== selectedAction.itemId) : [...chosen, action.itemId];
        }
        state = { ...state, selectedProductId: action.productId, selectedVariantId: action.kind === "variant" ? action.variantId : state.selectedVariantId,
          selectedOptionItemIds, selectedServiceSlotId: action.kind === "slot" ? action.slotId : state.selectedServiceSlotId,
          selectedOptionGroupId: action.kind === "option_group" ? action.groupId : state.selectedOptionGroupId, page: 0, expectsFreeInput: false };
        view = buildMetaUiView({ agentMessage: "Confira sua seleção e continue:", blocks: view.blocks, quickReplies: view.quickReplies, merchantName: view.title, state }, { selectionOnly: true });
      } else if (action?.kind === "tool" && ["show_content", "product_gallery", "media_page", "edit_cart_item"].includes(action.tool)) {
        if (action.tool === "show_content") view = { title: state.view?.title || "Sua loja", body: String(action.args.text || ""), choices: [], media: [], blocks: [], quickReplies: [] };
        else if (action.tool === "media_page") view = { title: "Mídias do produto", body: "Continue explorando o produto:", choices: [], media: action.args.media as any[], blocks: [], quickReplies: [] };
        else if (action.tool === "product_gallery") {
          const images = Array.isArray(action.args.images) ? action.args.images.filter((url): url is string => typeof url === "string" && url.startsWith("https://")) : [];
          const galleryPage = Number(action.args.page || 0);
          view = { title: "Fotos do produto", body: `Fotos ${galleryPage * 3 + 1} a ${Math.min(images.length, (galleryPage + 1) * 3)} de ${images.length}`,
            choices: galleryPage * 3 + 3 < images.length ? [{ label: "Mais fotos", action: { kind: "tool", tool: "product_gallery", args: { ...action.args, page: galleryPage + 1 } } }] : [],
            media: images.slice(galleryPage * 3, galleryPage * 3 + 3).map(link => ({ type: "image" as const, media: { link } })), blocks: [], quickReplies: [] };
        } else {
          const quantity = Number(action.args.quantity || 1);
          const selector = { ...(action.args.optionItemIds !== undefined ? { optionItemIds: action.args.optionItemIds } : {}),
            ...(action.args.serviceSlotId !== undefined ? { serviceSlotId: action.args.serviceSlotId } : {}) };
          view = { title: "Editar quantidade", body: `Quantidade atual: ${quantity}`, media: [], blocks: [], quickReplies: [], choices: [
            { label: "Adicionar uma unidade", action: { kind: "tool", tool: "update_cart_item", args: { variantId: action.args.variantId, quantity: quantity + 1, ...selector } } },
            ...(quantity > 1 ? [{ label: "Retirar uma unidade", action: { kind: "tool" as const, tool: "update_cart_item", args: { variantId: action.args.variantId, quantity: quantity - 1, ...selector } } }] : []),
            { label: "Remover item", action: { kind: "tool", tool: "remove_cart_item", args: { variantId: action.args.variantId, ...selector } } },
          ] };
        }
        if (action.tool !== "edit_cart_item") {
          const productId = typeof action.args.productId === "string" ? action.args.productId : metaProductContext(state.view)?.productId;
          view = withMetaProductNavigation(view, state.view, state, productId);
        }
        if (state.view) state = { ...state, previousViews: [...state.previousViews, state.view].slice(-6), page: 0 };
      } else {
        if (action?.kind === "menu") state = { ...state, pendingCheckoutEdit: undefined, pendingCoupon: undefined, pendingFlow: undefined, expectsFreeInput: false };
        const response: WhatsAppStructuredResponse = unreadMedia ? {
          agentMessage: responseProducer ? "📎 *Nesta etapa, vamos continuar por mensagem.*\n\nEscreva sua resposta para continuar."
            : (/^audio\//i.test(input.metaMedia?.mimeType ?? "") || interpreted?.kind === "audio_transcript")
            ? "🎙️ *Não consegui transcrever esse áudio agora.*\n\nPode escrever o que procura? Assim consigo continuar ajudando você.\n\n_As notas de voz devem estar em Ogg/Opus e ter até 3 MB._"
            : "📎 *Não consegui analisar esse anexo agora.*\n\nEscreva o nome do produto ou descreva o que procura para eu continuar ajudando.\n\n_Aceito fotos JPG, PNG ou WebP de até 3 MB e listas TXT/CSV._",
          blocks: [], quickReplies: [], state,
        } : responseProducer ? await responseProducer(message) : await this.conversation.respondStore({ verifiedSender, merchantId: input.merchantId, buyer: route.buyerData,
          message: action?.kind === "message" ? action.message : action?.kind === "menu" ? "Menu" : message, state,
          attachmentContext,
          messageId: relationship?.responseKey ?? claim.id,
          action: action?.kind === "tool" ? action : undefined });
        state = response.state;
        if (view) state = { ...state, previousViews: [...state.previousViews, view].slice(-6) };
        view = withMetaProductNavigation(buildMetaUiView(response), view, state); state.page = 0;
      }
      if (!view) throw new Error("whatsapp_ui_view_missing");
      // Returning to an archived welcome restores its text and controls. Its
      // original clip belongs to the first greeting, not every Back selection.
      if ((recoveredView || action?.kind === "back") && view.blocks.some(block => block.type === "welcome_animation")) includeMedia = false;
      if (!responseProducer) view = withMetaCartNavigation(view, state.cartHasItems);
      view = { ...view, stage: view.stage ?? state.stage };
      const presentation = presentMetaUi(view, revision, state.page, { canGoBack: state.previousViews.length > 0 && !view.blocks.some(b => b.type === "account_link_actions"), includeMedia, navigationOnly });
      state = { ...state, revision, view, page: presentation.page, selections: presentation.selections, numericSelections: presentation.numericSelections };
      saved = { marketingConversationId:relationship?.conversationId, marketingResponseKey:relationship?.responseKey, phase: "prepared", presentation, state, sessionId: route.whatsappSession.id, previousRevision: route.whatsappSession.conversationState?.revision ?? "", sent: [] };
      await this.save(claim, saved);
    }
    if (!saved.sessionApplied) {
      const current = route.whatsappSession.conversationState?.revision ?? "";
      // A late receipt can resume an earlier turn after a newer buyer message.
      if (current === (saved.previousRevision ?? "") || current === saved.state?.revision) {
        await this.sessions.update(saved.sessionId!, { conversationState: saved.state, checkoutSessionId: saved.state?.checkoutSessionId, lastActivityAt: new Date() });
      }
      saved.sessionApplied = true; await this.save(claim, saved);
    }
    const sent = saved.sent ?? [];
    for (let index = 0; index < saved.presentation!.messages.length; index++) {
      if (sent.some(item => item.index === index)) continue;
      saved.dispatchAttempts=(saved.dispatchAttempts ?? 0)+1;
      await this.save(claim, { ...saved, phase: "dispatching", dispatchingIndex: index, sent });
      let result: Awaited<ReturnType<SendWhatsAppResponseUseCase["sendUi"]>> | undefined;
      const deliver=async()=>{
        // CRM admission may await database locks after the first marker.
        // Revalidate this exact leased inbox immediately before provider IO.
        await this.save(claim,{...saved!,phase:"dispatching",dispatchingIndex:index,sent});
        result=await this.sender.sendUi({merchantId:input.merchantId,provider:input.provider,deviceId:input.deviceId,toNumber:input.fromNumber,
          text:"",uiMessage:saved!.presentation!.messages[index],correlationId:`zyon:${claim.id}:${index}`});
        return {status:result.status === "sent" || result.status === "queued" ? "accepted" as const : result.status === "unknown" ? "unknown" as const : "failed" as const,
          messageId:result.messageId};
      };
      if (saved.marketingConversationId && this.marketing) {
        const ui=saved.presentation!.messages[index];
        const text=ui.type === "text" ? ui.text.body : ui.type === "interactive" ? String((ui.interactive.body as {text?:string})?.text ?? "Mensagem da loja")
          : ui.type === "image" || ui.type === "video" || ui.type === "document" ? ui.media.caption ?? "Mídia da loja" : "Mensagem da loja";
        const attempted=await this.marketing.aiReply(input.merchantId,saved.marketingConversationId,
          `meta:${saved.marketingResponseKey ?? claim.id}:${index}:${saved.dispatchAttempts}`,conversationHistoryText(text,8000),deliver);
        if (!attempted) {await this.save(claim,{...saved,phase:"complete",sent});return;}
      } else await deliver();
      if (!result) throw new Error("whatsapp_send_result_unknown");
      if (result.status === "unknown") throw new Error("whatsapp_send_result_unknown");
      if (!result.messageId || !["sent", "queued"].includes(result.status)) {
        const message = saved.presentation!.messages[index];
        if (message.type === "interactive" && message.interactive.type === "button"
          && ["image", "video", "document"].includes(String((message.interactive.header as any)?.type))) {
          const { header: _rejectedMedia, ...interactive } = message.interactive;
          saved.presentation!.messages[index] = { type: "interactive", interactive };
          saved = { ...saved, phase: "prepared", sent };
          await this.save(claim, saved);
          index--; continue; // Retry the exact body/actions once without optional media.
        }
        // A definite rejection of an optional surface must not hide the rest of
        // the response. Persist its text replacement before attempting delivery.
        const fallback = message.type === "image" || message.type === "video" || message.type === "document"
          ? `Não consegui exibir esta mídia.${message.media.caption ? `\n\n${message.media.caption}` : ""}`
          : message.type === "interactive" && message.interactive.type === "flow"
            ? `Não consegui abrir o formulário. Responda aqui na conversa:\n\n${(message.interactive.body as { text?: string } | undefined)?.text ?? "Informe o dado solicitado."}`
            : message.type === "interactive" && message.interactive.type === "cta_url"
              ? `Continue sua compra pelo checkout seguro:\n${((message.interactive.action as any)?.parameters)?.url}` : undefined;
        if (fallback) {
          saved.presentation!.messages[index] = { type: "text", text: { body: fallback.slice(0, 4096) } };
          saved = { ...saved, phase: "prepared", sent };
          await this.save(claim, saved);
          index--; continue;
        }
        await this.save(claim, { ...saved, phase: "prepared", sent });
        throw new Error("whatsapp_send_failed");
      }
      sent.push({ index, messageId: result.messageId });
      saved = { ...saved, phase: "prepared", sent };
      await this.save(claim, saved);
    }
    await this.save(claim, { ...saved, phase: "complete", sent });
    if (saved.marketingConversationId) await this.marketing?.commerce(input.merchantId,saved.state!.conversationId);
  }

  private async save(claim: WhatsAppInboxClaim, state: SavedTurn): Promise<void> {
    if (!await this.inbox.saveResponse?.(claim, state as unknown as Record<string, unknown>)) throw new Error("whatsapp_inbox_lease_lost");
  }
}
