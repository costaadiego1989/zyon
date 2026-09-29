import React, { useEffect, useRef, useState } from "react";
import { Send, MessageSquare, Store } from "lucide-react";
import { Modal } from "../../../components/Modal.js";
import { FormTextarea } from "../../../components/FormField.js";
import { EmptyState } from "../../../components/EmptyState.js";
import { PageLoader } from "../../../components/PageLoader.js";
import type { SupportTicketStatus } from "@zyon/shared-types";
import { Button } from "../../../components/Button.js";
import { useSupportChat } from "../hooks/useSupportChat.js";
import { reportError } from "../../../hooks/useErrorReporter.js";
import type { TicketMessage } from "../../../hooks/useSupportSocket.js";
import { ExchangeCard } from "./ExchangeCard.js";
import { PartnerStoreDropdown } from "./PartnerStoreDropdown.js";

type DashboardApi = ReturnType<typeof import("../../../api-client.js").createDashboardApi>;

interface SupportChatDrawerProps {
  ticketId: string;
  connected: boolean;
  busy: boolean;
  actionError: string | null;
  onStatus: (status: SupportTicketStatus) => void;
  statusOptions: Array<{ value: SupportTicketStatus; label: string }>;
  buyerMessage: string;
  status: string;
  api: DashboardApi;
  onClose: () => void;
  onSend: (ticketId: string, content: string) => void;
  onJoin: (ticketId: string) => void;
  onLeave: (ticketId: string) => void;
  onNewMessage: (handler: (msg: TicketMessage) => void) => () => void;
}

export function SupportChatDrawer(props: SupportChatDrawerProps) {
  const { ticketId, buyerMessage, status, api, onClose, onSend, onJoin, onLeave, onNewMessage } = props;
  const { messages, loading, error, reload, addMessage, addOptimisticMerchantMessage } = useSupportChat(api, ticketId);
  const [input, setInput] = React.useState("");
  const [confirmClose, setConfirmClose] = useState(false);
  function close() { if (props.busy) return; if (input.trim()) setConfirmClose(true); else onClose(); }
  const [isMarketplaceOrigin, setIsMarketplaceOrigin] = useState(false);
  const [showTransferDropdown, setShowTransferDropdown] = useState(false);
  const [transferredTo, setTransferredTo] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Join/Leave ticket
  useEffect(() => {
    onJoin(ticketId);
    return () => { onLeave(ticketId); };
  }, [ticketId, onJoin, onLeave]);

  // Subscribe to new messages (ignore merchant's own — already added optimistically)
  useEffect(() => {
    const unsub = onNewMessage((msg) => {
      if (msg.ticketId === ticketId && msg.senderType !== "merchant") {
        addMessage(msg);
      }
    });
    return unsub;
  }, [ticketId, onNewMessage, addMessage]);

  // Auto-scroll
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    let cancelled = false;
    api
      .getTicketMarketplaceOrigin(ticketId)
      .then((result) => {
        if (!cancelled) setIsMarketplaceOrigin(result.isMarketplaceOrigin);
      })
      .catch((e) => reportError({ source: "SupportChatDrawer.getTicketMarketplaceOrigin", error: e }));
    return () => { cancelled = true; };
  }, [ticketId, api]);

  function handleTransferred(storeName: string) {
    setTransferredTo(storeName);
    setShowTransferDropdown(false);
  }

  function handleSend() {
    const text = input.trim();
    if (!text || !props.connected || props.busy) return;
    onSend(ticketId, text);
    // Optimistic add
    addOptimisticMerchantMessage(text);
    setInput("");
  }

  const ticketRef = ticketId.slice(-6).toUpperCase();

  return (
    <Modal isOpen title={"Chamado #" + ticketRef} subtitle="Converse com o comprador e acompanhe a resolução do chamado." presentation="center" size="lg" onClose={close} footer={confirmClose ? <div className="support-chat__close"><p>Há uma resposta que ainda não foi enviada.</p><Button variant="outline" onClick={() => setConfirmClose(false)}>Continuar editando</Button><Button variant="danger" onClick={onClose}>Descartar e fechar</Button></div> : <div className="support-chat__footer">{status !== "closed" && status !== "resolved" ? <><FormTextarea label="Sua resposta" value={input} onChange={setInput} maxLength={4000} rows={3} disabled={props.busy} placeholder="Escreva uma resposta clara para o comprador." hint={props.connected ? "Revise a resposta antes de enviar." : "Reconectando ao atendimento. Seu rascunho está preservado."} /><Button variant="primary" disabled={!input.trim() || !props.connected || props.busy || loading || Boolean(error)} onClick={handleSend}><Send size={16} /> Enviar resposta</Button></> : <p>Este chamado está {status === "resolved" ? "resolvido" : "fechado"}. O histórico continua disponível para consulta.</p>}</div>}>
      <div className="support-chat configuration-form">
        <div className="support-chat__status"><span className={"badge " + (status === "resolved" ? "ok" : status === "open" ? "warn" : "muted")}>{status === "open" ? "Aberto" : status === "in_progress" ? "Em atendimento" : status === "resolved" ? "Resolvido" : "Fechado"}</span><span role="status">{props.connected ? "Atendimento conectado" : "Reconectando ao atendimento"}</span></div>
        {props.actionError && <div className="panel-error" role="alert">{props.actionError}</div>}
        {props.statusOptions.length > 0 && <div className="support-chat__actions" aria-label="Atualizar etapa do chamado">{props.statusOptions.map(option => <Button key={option.value} variant="outline" size="sm" disabled={props.busy} onClick={() => props.onStatus(option.value)}>{option.value === "in_progress" ? "Iniciar atendimento" : option.value === "resolved" ? "Marcar como resolvido" : "Fechar chamado"}</Button>)}</div>}
        {/* Messages */}
        <div className="support-chat__messages">
          {/* Initial buyer message */}
          <div className="support-msg support-msg--buyer">
            <span className="support-msg-label">Comprador</span>
            <p>{buyerMessage}</p>
          </div>

          {loading ? (
            <PageLoader />
          ) : error ? <EmptyState icon={MessageSquare} title="Conversa indisponível" description={error} action={<Button variant="outline" onClick={() => void reload()}>Tentar novamente</Button>} /> : (
            messages.map((msg) => {
              if (msg.metadata?.kind === "ticket_transferred") {
                return (
                  <div
                    key={msg.id}
                    style={{
                      alignSelf: "center",
                      fontSize: 12,
                      color: "var(--color-text-muted)",
                      fontStyle: "italic",
                      padding: "4px 0",
                      textAlign: "center",
                    }}
                  >
                    Chamado transferido para {msg.metadata.toStoreName}
                  </div>
                );
              }

              const isReturnRequest = msg.metadata?.kind === "return_request";

              return (
                <div
                  key={msg.id}
                  className={`support-msg support-msg--${msg.senderType}`}
                  style={isReturnRequest ? { maxWidth: "100%", width: "100%" } : undefined}
                >
                  <span className="support-msg-label">
                    {msg.senderType === "buyer" ? "Comprador" : "Você"}
                  </span>
                  {msg.metadata?.kind === "return_request" ? (
                    <ExchangeCard metadata={msg.metadata} />
                  ) : (
                    <p>{msg.content}</p>
                  )}
                  <time style={{ fontSize: 10, color: "var(--color-muted)" }}>
                    {msg.id.startsWith("temp_") ? "Envio solicitado" : new Date(msg.createdAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
                  </time>
                </div>
              );
            })
          )}
          <div ref={bottomRef} />
        </div>

        {isMarketplaceOrigin && (
          <div style={{ padding: "12px 16px", borderTop: "1px solid var(--color-border)" }}>
            {transferredTo ? (
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  fontSize: 12,
                  color: "var(--color-success)",
                }}
              >
                <Store size={14} />
                Chamado transferido para {transferredTo}
              </div>
            ) : showTransferDropdown ? (
              <PartnerStoreDropdown
                api={api}
                ticketId={ticketId}
                onTransferred={handleTransferred}
              />
            ) : (
              <Button
                variant="outline"
                size="sm"
                fullWidth
                onClick={() => setShowTransferDropdown(true)}
              >
                <Store size={14} /> Vincular loja parceira
              </Button>
            )}
          </div>
        )}

      </div>
    </Modal>
  );
}
