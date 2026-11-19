import React, { useEffect, useRef, useState } from "react";
import { Send } from "lucide-react";
import { Modal } from "../../../components/Modal.js";
import { FormTextarea } from "../../../components/FormField.js";
import { Button } from "../../../components/Button.js";
import type { SupportTicketStatus } from "@zyon/shared-types";
import type { ConversationMessage } from "../../whatsapp-seller/conversation-types.js";

export interface CanonicalSupportChatState {
  messages: Array<ConversationMessage & { deliveryLabel?: string }>;
  loading: boolean;
  error: string | null;
  canSend: boolean;
  onSend: (content: string) => Promise<ConversationMessage | undefined>;
  reload: () => void;
  hasMore: boolean;
  loadMore: () => Promise<void>;
  modeLabel: string;
  sendHint: string;
}
interface Props {
  ticketId: string;
  connected: boolean;
  busy: boolean;
  actionError: string | null;
  status: string;
  statusOptions: Array<{ value: SupportTicketStatus; label: string }>;
  onStatus: (status: SupportTicketStatus) => void;
  onClose: () => void;
  whatsapp: CanonicalSupportChatState;
}

/** The support presentation with canonical messages only. No history fetch,
 * socket, marketplace lookup or optimistic merchant message is owned here. */
export function CanonicalSupportChat(props: Props) {
  const { whatsapp: view } = props;
  const [input, setInput] = useState("");
  const [confirmClose, setConfirmClose] = useState(false);
  const [confirmEnd, setConfirmEnd] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [historyBusy, setHistoryBusy] = useState(false);
  const [intent, setIntent] = useState<{ ticketId: string; clientMessageId: string; draft: string } | null>(null);
  const alive = useRef(true), inFlight = useRef(false), footer = useRef<HTMLDivElement>(null), bottom = useRef<HTMLDivElement>(null);
  const busy = props.busy || submitting;
  const canSend = view.canSend && !busy && !view.loading && !view.error;
  const closed = props.status === "closed" || props.status === "resolved";
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const lastMessageId = view.messages[view.messages.length - 1]?.id;
  useEffect(() => { bottom.current?.scrollIntoView?.({ block: "end", behavior: "auto" }); }, [lastMessageId]);
  useEffect(() => { if (closed) { setConfirmEnd(false); setConfirmClose(false); setInput(""); } }, [closed]);
  useEffect(() => {
    if (!intent || intent.ticketId !== props.ticketId) return;
    const message = view.messages.find(row => row.ticketId === intent.ticketId && row.clientMessageId === intent.clientMessageId);
    if (!message || !["accepted", "delivered", "read"].includes(message.delivery?.status ?? "")) return;
    setInput(current => current === intent.draft ? "" : current);
    setIntent(null);
  }, [intent, props.ticketId, view.messages]);

  function close() { if (busy) return; if (input.trim()) setConfirmClose(true); else props.onClose(); }
  function updateStatus(status: SupportTicketStatus) {
    if (busy || view.loading || view.error) return;
    if (status === "closed" && input.trim()) setConfirmEnd(true);
    else props.onStatus(status);
  }
  async function send() {
    const draft = input;
    const content = draft.trim();
    if (!content || !canSend || inFlight.current) return;
    inFlight.current = true; setSubmitting(true); setSendError(null);
    try {
      const receipt = await view.onSend(content);
      if (alive.current && receipt?.ticketId === props.ticketId && receipt.clientMessageId) {
        setIntent({ ticketId: receipt.ticketId, clientMessageId: receipt.clientMessageId, draft });
      }
    } catch {
      if (alive.current) setSendError("Não foi possível confirmar o envio. Seu rascunho foi preservado.");
    } finally {
      inFlight.current = false; if (alive.current) setSubmitting(false);
    }
  }
  async function older() {
    if (historyBusy || view.loading) return;
    setHistoryBusy(true);
    try { await view.loadMore(); }
    finally { if (alive.current) setHistoryBusy(false); }
  }
  function continueEditing() {
    setConfirmClose(false); setConfirmEnd(false);
    // The footer remounts its textarea after the confirmation closes.
    requestAnimationFrame(() => footer.current?.querySelector("textarea")?.focus());
  }
  return <Modal isOpen title={"Conversa #" + props.ticketId.slice(-6).toUpperCase()}
    subtitle="Histórico e atendimento no WhatsApp da empresa." presentation="center" size="lg" onClose={close}
    footer={confirmEnd ? <div className="support-chat__close"><p>Há uma resposta não enviada. Ao encerrar, a IA volta a atender esta conversa.</p>
      <Button variant="outline" disabled={busy} onClick={continueEditing}>Continuar editando</Button><Button variant="danger" disabled={busy} onClick={() => props.onStatus("closed")}>Encerrar sem enviar</Button></div>
      : confirmClose ? <div className="support-chat__close"><p>Há uma resposta que ainda não foi enviada.</p>
      <Button variant="outline" onClick={continueEditing}>Continuar editando</Button><Button variant="danger" onClick={props.onClose}>Descartar e fechar</Button></div>
      : <div className="support-chat__footer" ref={footer}>{closed ? <p>Atendimento encerrado. O histórico continua disponível para consulta.</p> : <>
        <FormTextarea label="Sua resposta" value={input} onChange={setInput} maxLength={4000} rows={3} disabled={busy}
          placeholder="Escreva uma resposta clara para o cliente." hint={view.sendHint} />
        <Button variant="primary" disabled={!input.trim() || !canSend} loading={submitting} onClick={() => void send()}><Send size={16} aria-hidden="true" /> Enviar resposta</Button></>}
      </div>}>
    <div className="support-chat configuration-form">
      <div className="support-chat__toolbar">
        <div className="support-chat__status"><span className={"badge " + (closed ? "muted" : "warn")}>{view.modeLabel}</span>
          <span role="status">{props.connected ? "Atendimento conectado" : "Reconectando ao atendimento"}</span></div>
        {(props.actionError || sendError) && <div className="panel-error" role="alert">{props.actionError || sendError}</div>}
        {props.statusOptions.length > 0 && <div className="support-chat__actions" aria-label="Ações do atendimento">{props.statusOptions.map(option =>
          <Button key={option.value} variant="outline" size="sm" disabled={busy || view.loading || Boolean(view.error)} onClick={() => updateStatus(option.value)}>{option.label}</Button>)}</div>}
      </div>
      {view.error && <div className="panel-error" role="alert"><p>{view.error}</p><Button variant="outline" onClick={view.reload}>Recarregar histórico</Button></div>}
      {view.loading && <p role="status">Carregando histórico da conversa…</p>}
      {view.hasMore && <Button variant="ghost" loading={historyBusy} disabled={view.loading} onClick={() => void older()}>Carregar mais mensagens</Button>}
      <div className="support-chat__messages" role="log" aria-label="Histórico da conversa" aria-live="polite" aria-relevant="additions text" aria-busy={view.loading}>
        {!view.loading && !view.error && view.messages.length === 0 && <p>Nenhuma mensagem registrada nesta conversa.</p>}
        {view.messages.map(message => <div key={message.id} className={"support-msg support-msg--" + message.senderType}>
          <span className="support-msg-label">{message.senderType === "buyer" ? "Cliente" : message.senderType === "system" ? "Assistente virtual" : "Você"}</span>
          <p>{message.content}</p><time dateTime={message.createdAt}>{new Date(message.createdAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}</time>
          {message.deliveryLabel && <span className="support-chat__delivery">{message.deliveryLabel}</span>}
        </div>)}
        <div ref={bottom} />
      </div>
    </div>
  </Modal>;
}
