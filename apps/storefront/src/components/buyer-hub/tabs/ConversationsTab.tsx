"use client";

import { useState, useCallback, useId } from "react";
import { FiMessageSquare, FiThumbsUp, FiThumbsDown, FiChevronRight } from "react-icons/fi";
import type { BuyerConversation, ConversationMessage } from "@/lib/viewmodels/useBuyerHub";

export interface ConversationsTabProps {
  conversations: BuyerConversation[];
  loading: boolean;
  error?: string | null;
  merchantId?: string;
  currentSessionId?: string | null;
  onRetry?: () => void;
  onResume?: (conversation: BuyerConversation) => Promise<void>;
  onRate: (conversationId: string, messageId: string, rating: "up" | "down") => Promise<void>;
}

const dateFmt = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short" });
const dateTimeFmt = new Intl.DateTimeFormat("pt-BR", {
  dateStyle: "short",
  timeStyle: "short",
});

function formatDate(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return dateFmt.format(d);
}

function formatDateTime(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return dateTimeFmt.format(d);
}

function truncate(text: string, max = 60): string {
  const t = (text || "").trim().replace(/\s+/g, " ");
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1).trimEnd()}…`;
}

function isAssistant(role: ConversationMessage["role"]): boolean {
  return role === "assistant" || role === "agent";
}

function RoleBadge({ role }: { role: ConversationMessage["role"] }) {
  const isUser = role === "user" || role === "buyer";
  const isAsst = isAssistant(role);
  const bg = isUser ? "var(--aacp-accent)" : isAsst ? "var(--aacp-success)" : "var(--aacp-surface-3)";
  const fg = isUser ? "var(--aacp-panel-bg)" : isAsst ? "var(--aacp-panel-bg)" : "var(--aacp-fg)";
  const label = isUser ? "Você" : isAsst ? "Assistente" : "Sistema";
  return (
    <span
      style={{
        display: "inline-block",
        padding: "2px 8px",
        borderRadius: 999,
        background: bg,
        color: fg,
        fontSize: 11,
        fontWeight: 600,
        letterSpacing: 0.2,
        textTransform: "uppercase",
        lineHeight: 1.4,
      }}
      aria-label={`Remetente: ${label}`}
    >
      {label}
    </span>
  );
}

function MessageBubble({
  msg,
  conversationId,
  onRate,
}: {
  msg: ConversationMessage;
  conversationId: string;
  onRate: ConversationsTabProps["onRate"];
}) {
  const [busy, setBusy] = useState<"up" | "down" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const isAsst = isAssistant(msg.role);

  const handle = useCallback(
    async (rating: "up" | "down") => {
      if (busy) return;
      setBusy(rating);
      setError(null);
      try {
        await onRate(conversationId, msg.id, rating);
      } catch (e: any) {
        setError(e?.message || "Não foi possível registrar sua avaliação.");
      } finally {
        setBusy(null);
      }
    },
    [busy, conversationId, msg.id, onRate],
  );

  const wrapperStyle: React.CSSProperties = {
    display: "flex",
    flexDirection: "column",
    gap: 6,
    padding: "10px 12px",
    borderRadius: 10,
    background: isAsst ? "var(--aacp-surface-2)" : "var(--aacp-surface-3)",
    border: "1px solid var(--aacp-line)",
  };

  const metaStyle: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
    flexWrap: "wrap",
  };

  const contentStyle: React.CSSProperties = {
    margin: 0,
    fontSize: 14,
    lineHeight: 1.5,
    color: "var(--aacp-fg)",
    whiteSpace: "pre-wrap",
    wordBreak: "break-word",
  };

  const actionsStyle: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    gap: 8,
    marginTop: 4,
  };

  const iconBtn = (active: boolean, kind: "up" | "down"): React.CSSProperties => ({
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    width: 32,
    height: 32,
    borderRadius: 8,
    border: `1px solid ${active ? "var(--aacp-accent)" : "var(--aacp-line)"}`,
    background: active ? "var(--aacp-accent)" : "var(--aacp-panel-bg)",
    color: active ? "var(--aacp-panel-bg)" : "var(--aacp-fg)",
    cursor: busy ? "wait" : "pointer",
    opacity: busy && busy !== kind ? 0.5 : 1,
    transition: "transform 80ms ease, background 120ms ease, color 120ms ease",
  });

  return (
    <li style={wrapperStyle} aria-label={`Mensagem de ${msg.role}`}>
      <div style={metaStyle}>
        <RoleBadge role={msg.role} />
        <span style={{ fontSize: 12, color: "var(--aacp-muted)" }}>
          {formatDateTime(msg.created_at)}
        </span>
      </div>
      <p style={contentStyle}>{msg.content}</p>
      {isAsst ? (
        <div style={actionsStyle} role="group" aria-label="Avaliar mensagem">
          <button data-neu="control"
            type="button"
            onClick={() => handle("up")}
            disabled={!!busy}
            aria-label="Marcar mensagem como útil"
            aria-pressed={msg.rating === "up"}
            title="Útil"
            style={iconBtn(msg.rating === "up", "up")}
            onMouseDown={(e) => {
              (e.currentTarget as HTMLButtonElement).style.transform = "scale(0.96)";
            }}
            onMouseUp={(e) => {
              (e.currentTarget as HTMLButtonElement).style.transform = "scale(1)";
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLButtonElement).style.transform = "scale(1)";
            }}
          >
            <FiThumbsUp
              size={14}
              fill={msg.rating === "up" ? "currentColor" : "none"}
              aria-hidden="true"
            />
          </button>
          <button data-neu="control"
            type="button"
            onClick={() => handle("down")}
            disabled={!!busy}
            aria-label="Marcar mensagem como não útil"
            aria-pressed={msg.rating === "down"}
            title="Não útil"
            style={iconBtn(msg.rating === "down", "down")}
            onMouseDown={(e) => {
              (e.currentTarget as HTMLButtonElement).style.transform = "scale(0.96)";
            }}
            onMouseUp={(e) => {
              (e.currentTarget as HTMLButtonElement).style.transform = "scale(1)";
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLButtonElement).style.transform = "scale(1)";
            }}
          >
            <FiThumbsDown
              size={14}
              fill={msg.rating === "down" ? "currentColor" : "none"}
              aria-hidden="true"
            />
          </button>
          {error ? (
            <span
              role="alert"
              style={{ fontSize: 12, color: "var(--aacp-muted)" }}
            >
              {error}
            </span>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

function ConversationRow({ conv, current, onRate, onResume }: {
  conv: BuyerConversation;
  current: boolean;
  onRate: ConversationsTabProps["onRate"];
  onResume: ConversationsTabProps["onResume"];
}) {
  const [expanded, setExpanded] = useState(false);
  const [resuming, setResuming] = useState(false);
  const [resumeError, setResumeError] = useState<string | null>(null);
  const panelId = useId();
  const title = truncate(conv.messages.find((message) => message.role === "buyer" || message.role === "user")?.content || `Conversa com ${conv.merchant_name || "a loja"}`, 80);
  const finished = conv.status === "completed" || conv.status === "expired";
  const ongoing = !finished && (conv.status === "in_progress" || current);
  const canResume = current && !finished && Boolean(onResume);
  const badge = finished ? "Finalizada" : ongoing ? "Em andamento" : "Histórico";
  const count = conv.messages.length;
  const resume = async () => {
    if (!onResume || resuming) return;
    setResuming(true);
    setResumeError(null);
    try { await onResume(conv); }
    catch { setResumeError("Não foi possível retomar esta conversa. Atualize a lista e tente novamente."); }
    finally { setResuming(false); }
  };
  return <li className="buyer-conversation-row" aria-label={title}>
    <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
      <h3 style={{ margin: 0, minWidth: 0, fontSize: 14, fontWeight: 600, lineHeight: 1.5, overflowWrap: "anywhere" }}>{title}</h3>
      <span style={{ flexShrink: 0, padding: "3px 7px", borderRadius: 5, fontSize: 11, lineHeight: 1.5,
        color: ongoing ? "var(--aacp-accent-text, var(--aacp-fg))" : "var(--aacp-muted)",
        background: ongoing ? "color-mix(in srgb, var(--aacp-accent) 12%, transparent)" : "var(--aacp-surface-2)" }}>{badge}</span>
    </div>
    <p style={{ margin: "6px 0 0", fontSize: 12, lineHeight: 1.6, color: "var(--aacp-muted)" }}>
      {conv.merchant_name || "Loja"} · {formatDate(conv.last_message_at || conv.started_at)} · {count} {count === 1 ? "mensagem" : "mensagens"}
      {current && !finished ? " · Conversa atual" : ""}
    </p>
    <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", marginTop: 6 }}>
      {canResume && <button type="button" className="buyer-conversation-action" onClick={resume} disabled={resuming}>
        {resuming ? "Abrindo conversa…" : "Continuar conversa"}<FiChevronRight aria-hidden="true" size={14} />
      </button>}
      <button type="button" className="buyer-conversation-action" aria-expanded={expanded} aria-controls={panelId} onClick={() => setExpanded(!expanded)}>
        {expanded ? "Ocultar mensagens" : "Ver mensagens"}
      </button>
    </div>
    {resumeError && <p role="alert" style={{ fontSize: 13, margin: "8px 0 0", color: "var(--aacp-muted)" }}>{resumeError}</p>}
    {expanded && <div id={panelId} role="region" aria-label={`Mensagens de ${title}`} style={{ paddingTop: 10 }}>
      {finished && <p style={{ margin: "0 0 12px", fontSize: 12, color: "var(--aacp-muted)" }}>
        {conv.status === "completed" ? "A compra desta conversa foi encerrada. As mensagens continuam disponíveis para consulta." : "Esta sessão expirou. As mensagens continuam disponíveis para consulta."}
      </p>}
      {count ? <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 8 }}>
        {conv.messages.map((message) => <MessageBubble key={message.id} msg={message} conversationId={conv.id} onRate={onRate} />)}
      </ul> : <p style={{ color: "var(--aacp-muted)", fontSize: 13 }}>Sem mensagens nesta conversa.</p>}
    </div>}
  </li>;
}

export default function ConversationsTab({ conversations, loading, error, merchantId, currentSessionId, onRate, onRetry, onResume }: ConversationsTabProps) {
  const scoped = merchantId ? conversations.filter((conversation) => conversation.merchant_id === merchantId) : conversations;
  const ordered = [...scoped].sort((a, b) => Number(b.session_id === currentSessionId) - Number(a.session_id === currentSessionId));
  return <section aria-label="Histórico de conversas">
    <style>{`
      .buyer-conversation-row { padding:16px 0; border-bottom:1px solid var(--aacp-line); color:var(--aacp-fg) }
      .buyer-conversation-action { display:inline-flex; gap:5px; align-items:center; min-height:44px; padding:4px 0 !important; border:0 !important; border-radius:4px !important; box-shadow:none !important; background:transparent !important; color:var(--aacp-fg); font:inherit; font-size:13px; font-weight:600; cursor:pointer }
      .buyer-conversation-action:focus-visible { outline:2px solid var(--aacp-accent); outline-offset:3px }
      .buyer-conversation-action:disabled { opacity:.6; cursor:wait }
      .buyer-conversation-action:hover:not(:disabled) { text-decoration:underline }
    `}</style>
    <p style={{ margin: "0 0 4px", fontSize: 13, lineHeight: 1.5, color: "var(--aacp-muted)" }}>Consulte suas mensagens ou continue a conversa atual.</p>
    {loading ? <p role="status" aria-live="polite" style={{ padding: "20px 0", color: "var(--aacp-muted)" }}>Carregando conversas…</p>
      : error ? <div role="alert"><p>{error}</p><button type="button" className="buyer-conversation-action" onClick={onRetry}>Tentar novamente</button></div>
      : ordered.length ? <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
        {ordered.map((conv) => <ConversationRow key={conv.id} conv={conv} current={Boolean(currentSessionId && conv.session_id === currentSessionId && conv.merchant_id === merchantId)} onRate={onRate} onResume={onResume} />)}
      </ul> : <div role="status" style={{ padding: "32px 0", color: "var(--aacp-muted)", fontSize: 14 }}>
        <FiMessageSquare size={24} aria-hidden="true" /><p style={{ color: "var(--aacp-fg)", fontWeight: 600 }}>Nenhuma conversa salva</p>
        <p>Suas conversas com a assistente nesta loja aparecerão aqui.</p>
      </div>}
  </section>;
}
