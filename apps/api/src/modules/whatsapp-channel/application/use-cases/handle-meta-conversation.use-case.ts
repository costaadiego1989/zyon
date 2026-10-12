import { Inject, Injectable, Optional } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { WHATSAPP_CONVERSATION_PORT, type WhatsAppConversationPort } from "../../domain/ports/whatsapp-conversation.port.js";
import { WHATSAPP_SESSION_REPOSITORY, type WhatsAppSessionRepository } from "../../domain/ports/whatsapp-session-repository.port.js";
import { WHATSAPP_WEBHOOK_INBOX, type WhatsAppWebhookInbox, type WhatsAppInboxClaim } from "../../domain/ports/whatsapp-webhook-inbox.port.js";
import { buildMetaUiView, presentMetaUi } from "../../domain/ui/meta-ui-renderer.js";
import type { MetaUiPresentation, StoreUiAction, WhatsAppConversationState, WhatsAppStructuredResponse } from "../../domain/ui/meta-ui.types.js";
import { SendWhatsAppResponseUseCase } from "./send-whatsapp-response.use-case.js";
import type { IncomingMessageInput } from "./handle-incoming-message.use-case.js";
import type { RouteResult } from "./route-to-session.use-case.js";
import { MetaUiCapabilitiesAdapter } from "../../infrastructure/adapters/meta-ui-capabilities.adapter.js";

interface SavedTurn { phase: "generating" | "prepared" | "dispatching" | "complete"; presentation?: MetaUiPresentation; state?: WhatsAppConversationState; sessionId?: string; sent?: Array<{ index: number; messageId: string }>; dispatchingIndex?: number }

@Injectable()
export class HandleMetaConversationUseCase {
  constructor(
    @Inject(WHATSAPP_CONVERSATION_PORT) private readonly conversation: WhatsAppConversationPort,
    @Inject(WHATSAPP_SESSION_REPOSITORY) private readonly sessions: WhatsAppSessionRepository,
    @Inject(WHATSAPP_WEBHOOK_INBOX) private readonly inbox: WhatsAppWebhookInbox,
    private readonly sender: SendWhatsAppResponseUseCase,
    @Optional() private readonly capabilities?: MetaUiCapabilitiesAdapter,
  ) {}

  async execute(input: IncomingMessageInput, route: RouteResult): Promise<void> {
    if (Date.now() - input.timestamp > 24 * 60 * 60 * 1000) throw new Error("whatsapp_service_window_expired");
    const claim = input.inboxClaim;
    if (!claim || !this.inbox.saveResponse || !this.conversation.respondStore) throw new Error("whatsapp_durable_ui_unavailable");
    let saved = claim.responseState as unknown as SavedTurn | undefined;
    if (saved?.phase === "generating" || saved?.phase === "dispatching") throw new Error("whatsapp_turn_result_unknown");
    if (!saved?.presentation || !saved.state) {
      await this.save(claim, { phase: "generating" });
      let state: WhatsAppConversationState = route.whatsappSession.conversationState ?? { version: 1, conversationId: randomUUID(), stage: "store", history: [], revision: "", page: 0, previousViews: [] };
      if (this.capabilities) state = { ...state, ...await this.capabilities.get(input.merchantId, input.deviceId) };
      let action: StoreUiAction | undefined;
      const numeric = /^\d{1,2}$/.test(input.body.trim()) ? Number(input.body.trim()) : NaN;
      let invalidSelection = false;
      if (input.interactiveId) {
        action = state.selections?.[input.interactiveId];
        invalidSelection = !action;
      } else if (input.body.trim() === "0" && state.previousViews.length) action = { kind: "back" };
      else if (!state.expectsFreeInput && numeric >= 1 && numeric <= (state.numericSelections?.length ?? 0)) action = state.numericSelections?.[numeric - 1];
      else if (/^(menu|in[ií]cio)$/i.test(input.body.trim())) action = { kind: "menu" };

      const revision = claim.id;
      let view = state.view;
      let includeMedia = true;
      if (invalidSelection && view) { view = { ...view, body: "Essa opção pertence a uma etapa anterior. Escolha uma das opções atuais ou escreva sua pergunta." }; includeMedia = false; }
      else if (action?.kind === "page" && view) { state = { ...state, page: action.page }; includeMedia = false; }
      else if (action?.kind === "back" && state.previousViews.length) { view = state.previousViews.at(-1); state = { ...state, page: 0, previousViews: state.previousViews.slice(0, -1) }; }
      else if ((action?.kind === "variant" || action?.kind === "option") && view) {
        state = { ...state, selectedProductId: action.productId, selectedVariantId: action.kind === "variant" ? action.variantId : state.selectedVariantId,
          selectedOptionItemIds: action.kind === "option" ? [...new Set([...(state.selectedOptionItemIds ?? []), action.itemId])] : state.selectedOptionItemIds, page: 0 };
        view = buildMetaUiView({ agentMessage: "Confira sua seleção e continue:", blocks: view.blocks, quickReplies: view.quickReplies, merchantName: view.title, state });
      } else if (action?.kind === "tool" && ["show_content", "product_gallery", "edit_cart_item"].includes(action.tool)) {
        if (action.tool === "show_content") view = { title: state.view?.title || "Sua loja", body: String(action.args.text || ""), choices: [], media: [], blocks: [], quickReplies: [] };
        else if (action.tool === "product_gallery") {
          const images = Array.isArray(action.args.images) ? action.args.images.filter((url): url is string => typeof url === "string" && url.startsWith("https://")) : [];
          const galleryPage = Number(action.args.page || 0);
          view = { title: "Fotos do produto", body: `Fotos ${galleryPage * 3 + 1} a ${Math.min(images.length, (galleryPage + 1) * 3)} de ${images.length}`,
            choices: galleryPage * 3 + 3 < images.length ? [{ label: "Mais fotos", action: { kind: "tool", tool: "product_gallery", args: { ...action.args, page: galleryPage + 1 } } }] : [],
            media: images.slice(galleryPage * 3, galleryPage * 3 + 3).map(link => ({ type: "image" as const, media: { link } })), blocks: [], quickReplies: [] };
        } else {
          const quantity = Number(action.args.quantity || 1);
          view = { title: "Editar quantidade", body: `Quantidade atual: ${quantity}`, media: [], blocks: [], quickReplies: [], choices: [
            { label: "Adicionar uma unidade", action: { kind: "tool", tool: "update_cart_item", args: { variantId: action.args.variantId, quantity: quantity + 1 } } },
            ...(quantity > 1 ? [{ label: "Retirar uma unidade", action: { kind: "tool" as const, tool: "update_cart_item", args: { variantId: action.args.variantId, quantity: quantity - 1 } } }] : []),
            { label: "Remover item", action: { kind: "tool", tool: "remove_cart_item", args: { variantId: action.args.variantId } } },
          ] };
        }
        if (state.view) state = { ...state, previousViews: [...state.previousViews, state.view].slice(-6), page: 0 };
      } else {
        const response: WhatsAppStructuredResponse = await this.conversation.respondStore({ merchantId: input.merchantId, buyer: route.buyerData,
          message: action?.kind === "message" ? action.message : action?.kind === "menu" ? "Menu" : input.body, state,
          action: action?.kind === "tool" ? action : undefined });
        state = response.state;
        if (view) state = { ...state, previousViews: [...state.previousViews, view].slice(-6) };
        view = buildMetaUiView(response); state.page = 0;
      }
      if (!view) throw new Error("whatsapp_ui_view_missing");
      const presentation = presentMetaUi(view, revision, state.page, { canGoBack: state.previousViews.length > 0, includeMedia });
      state = { ...state, revision, view, page: presentation.page, selections: presentation.selections, numericSelections: presentation.numericSelections };
      saved = { phase: "prepared", presentation, state, sessionId: route.whatsappSession.id, sent: [] };
      await this.save(claim, saved);
    }
    await this.sessions.update(saved.sessionId!, { conversationState: saved.state, lastActivityAt: new Date() });
    const sent = saved.sent ?? [];
    for (let index = 0; index < saved.presentation!.messages.length; index++) {
      if (sent.some(item => item.index === index)) continue;
      await this.save(claim, { ...saved, phase: "dispatching", dispatchingIndex: index, sent });
      const result = await this.sender.sendUi({ merchantId: input.merchantId, provider: input.provider, deviceId: input.deviceId, toNumber: input.fromNumber,
        text: "", uiMessage: saved.presentation!.messages[index], correlationId: `zyon:${claim.id}:${index}` });
      if (result.status === "unknown") throw new Error("whatsapp_send_result_unknown");
      if (!result.messageId || !["sent", "queued"].includes(result.status)) {
        await this.save(claim, { ...saved, phase: "prepared", sent });
        throw new Error("whatsapp_send_failed");
      }
      sent.push({ index, messageId: result.messageId });
      saved = { ...saved, phase: "prepared", sent };
      await this.save(claim, saved);
    }
    await this.save(claim, { ...saved, phase: "complete", sent });
  }

  private async save(claim: WhatsAppInboxClaim, state: SavedTurn): Promise<void> {
    if (!await this.inbox.saveResponse?.(claim, state as unknown as Record<string, unknown>)) throw new Error("whatsapp_inbox_lease_lost");
  }
}
