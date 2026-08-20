import React, { useEffect, useRef } from "react";
import { X, Send, MessageSquare } from "lucide-react";
import { Button } from "../../../components/Button.js";
import { useSupportChat } from "../hooks/useSupportChat.js";
import type { TicketMessage } from "../../../hooks/useSupportSocket.js";

type DashboardApi = ReturnType<typeof import("../../../api-client.js").createDashboardApi>;

interface SupportChatDrawerProps {
  ticketId: string;
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
  const { messages, loading, addMessage, addOptimisticMerchantMessage } = useSupportChat(api, ticketId);
  const [input, setInput] = React.useState("");
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

  function handleSend() {
    const text = input.trim();
    if (!text) return;
    onSend(ticketId, text);
    // Optimistic add
    addOptimisticMerchantMessage(text);
    setInput("");
  }

  const ticketRef = ticketId.slice(-6).toUpperCase();

  return (
    <div className="support-drawer-overlay" onClick={onClose}>
      <aside
        className="support-drawer"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label={`Chat do chamado ${ticketRef}`}
      >
        {/* Header */}
        <header className="support-drawer-header">
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <MessageSquare size={16} />
            <strong>Chamado #{ticketRef}</strong>
            <span className={`badge ${status === "open" ? "warn" : status === "resolved" ? "ok" : "muted"}`} style={{ fontSize: 10, padding: "2px 6px" }}>
              {status === "open" ? "Aberto" : status === "in_progress" ? "Em atendimento" : status === "resolved" ? "Resolvido" : "Fechado"}
            </span>
          </div>
          <button type="button" onClick={onClose} aria-label="Fechar drawer" style={{ background: "none", border: "none", cursor: "pointer", padding: 4 }}>
            <X size={18} />
          </button>
        </header>

        {/* Messages */}
        <div className="support-drawer-body">
          {/* Initial buyer message */}
          <div className="support-msg support-msg--buyer">
            <span className="support-msg-label">Comprador</span>
            <p>{buyerMessage}</p>
          </div>

          {loading ? (
            <div style={{ textAlign: "center", padding: 16, color: "var(--color-muted)" }}>Carregando...</div>
          ) : (
            messages.map((msg) => (
              <div key={msg.id} className={`support-msg support-msg--${msg.senderType}`}>
                <span className="support-msg-label">
                  {msg.senderType === "buyer" ? "Comprador" : "Você"}
                </span>
                <p>{msg.content}</p>
                <time style={{ fontSize: 10, color: "var(--color-muted)" }}>
                  {new Date(msg.createdAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
                </time>
              </div>
            ))
          )}
          <div ref={bottomRef} />
        </div>

        {/* Input */}
        {status !== "closed" && status !== "resolved" ? (
          <footer className="support-drawer-footer" style={{ display: "flex", alignItems: "flex-end", gap: 8, padding: "12px 16px", borderTop: "1px solid var(--color-border)" }}>
            <textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => {
                setInput(e.target.value);
                // Auto-grow
                const el = textareaRef.current;
                if (el) {
                  el.style.height = "auto";
                  el.style.height = Math.min(el.scrollHeight, 120) + "px";
                }
              }}
              placeholder="Digite sua resposta..."
              rows={1}
              style={{ resize: "none", minHeight: 36, maxHeight: 120, lineHeight: "20px", padding: "8px 12px" }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleSend();
                  // Reset height
                  const el = textareaRef.current;
                  if (el) el.style.height = "auto";
                }
              }}
            />
            <Button variant="primary" size="sm" onClick={() => { handleSend(); const el = textareaRef.current; if (el) el.style.height = "auto"; }} disabled={!input.trim()} style={{ height: 36 }}>
              <Send size={14} /> Enviar
            </Button>
          </footer>
        ) : null}
      </aside>
    </div>
  );
}
