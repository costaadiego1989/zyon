import React from "react";
import { AlertCircle, MessageSquareText } from "lucide-react";
import { Modal } from "../../../components/Modal.js";
import { Button } from "../../../components/Button.js";
import { SupportChatDrawer } from "../../support-settings/components/SupportChatDrawer.js";
import { conversationActions, conversationDeliveryLabel } from "../conversation-actions.js";
import type { ConversationContext, ConversationDetail } from "../conversation-types.js";
import type { ConversationNavigation } from "../useConversationNavigation.js";
import type { useWhatsAppConversations } from "../useWhatsAppConversations.js";
import type { SupportTicketStatus } from "@zyon/shared-types";
import "../../support-settings/support-settings.css";

type DashboardApi = ReturnType<typeof import("../../../api-client.js").createDashboardApi>;
interface Props { context: ConversationContext | null; api: DashboardApi; vm: ReturnType<typeof useWhatsAppConversations>; ticketId?: string; onClose?: () => void; registerNavigationGuard?: ConversationNavigation["register"] }
const noop = () => {};
const noMessages = () => () => {};
const staffAlertLabels: Record<NonNullable<ConversationDetail["staffAlert"]>["status"], string> = {
  queued: "Alerta à equipe aguardando envio", accepted: "Alerta à equipe aceito pelo canal", unavailable: "Alerta à equipe indisponível",
  failed: "Falha no alerta à equipe", unknown: "Envio do alerta à equipe sem confirmação", delivered: "Alerta à equipe entregue", read: "Alerta à equipe lido",
};

export function WhatsAppConversationDrawer({ context, api, vm, ticketId, onClose, registerNavigationGuard }: Props) {
  const detail = vm.detail;
  const close = onClose ?? vm.closeDrawer;
  if (!detail) {
    if (!vm.detailLoading && !vm.detailError) return null;
    return <Modal isOpen title="Conversa do WhatsApp" onClose={close} size="lg" presentation="center">
      {vm.detailLoading ? <div className="whatsapp-conversation-state" role="status"><MessageSquareText size={28} strokeWidth={1.5} aria-hidden="true" /><p>Carregando histórico da conversa…</p></div> : <div className="whatsapp-conversation-state" role="alert"><AlertCircle size={28} strokeWidth={1.5} aria-hidden="true" /><p>{vm.detailError}</p>
        {ticketId && <Button variant="outline" onClick={() => void vm.open(ticketId)}>Tentar novamente</Button>}</div>}
    </Modal>;
  }
  const actions = conversationActions(context, detail, vm.connected);
  const statusOptions: Array<{ value: SupportTicketStatus; label: string }> = [];
  if (actions.claim) statusOptions.push({ value: "in_progress", label: "Assumir atendimento" });
  if (actions.close) statusOptions.push({ value: "closed", label: "Encerrar e retomar IA" });
  const modeLabel = detail.binding?.mode === "human" ? actions.close ? "Atendimento humano com você" : "Atendimento humano com outro operador"
    : detail.binding?.mode === "waiting_human" ? "Aguardando atendimento humano" : detail.binding?.mode === "ai" ? "Atendimento humano encerrado · IA ativa" : "Vínculo indisponível";
  const sendHint = !actions.close ? "Assuma este atendimento antes de responder."
    : !detail.channel?.enabled || detail.channel.status !== "ACTIVE" ? "O canal está indisponível para responder. Você ainda pode encerrar o atendimento e retomar a IA."
    : !vm.connected ? "Reconectando. Seu rascunho está preservado." : "Revise a resposta antes de enviar. O estado do envio aparece no histórico.";
  return <SupportChatDrawer key={JSON.stringify([context?.merchant_id, context?.user_id, detail.ticket.id])}
    ticketId={detail.ticket.id} buyerMessage={detail.ticket.buyerMessage} status={detail.ticket.status}
    connected={vm.connected} busy={vm.busy} actionError={vm.actionError} statusOptions={statusOptions} api={api} onClose={close}
    onStatus={status => { const operation = status === "in_progress" ? vm.claim() : status === "closed" ? vm.closeCase() : Promise.reject(Error("conversation_command_unavailable")); void operation.catch(() => {}); }}
    onSend={noop} onJoin={noop} onLeave={noop} onNewMessage={noMessages}
    whatsapp={{ registerNavigationGuard, messages: detail.messages.map(message => ({ ...message, deliveryLabel: message.delivery ? conversationDeliveryLabel(message.delivery.status) : undefined })),
      loading: vm.detailLoading, error: vm.detailError, canSend: actions.send, onSend: vm.send,
      reload: () => void vm.open(detail.ticket.id), hasMore: detail.has_more, loadMore: vm.loadMoreMessages, modeLabel, sendHint,
      staffAlertLabel: detail.staffAlert ? staffAlertLabels[detail.staffAlert.status] : undefined }} />;
}
