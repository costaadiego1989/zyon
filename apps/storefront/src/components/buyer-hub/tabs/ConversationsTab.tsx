"use client";

import { useState, useCallback, useId } from "react";
import { FiMessageSquare, FiThumbsUp, FiThumbsDown, FiChevronRight } from "react-icons/fi";
import type { BuyerConversation, ConversationMessage } from "@/lib/viewmodels/useBuyerHub";

import { caseLabel, type SupportCaseSummary } from '@/lib/services/support-case.service';

export interface ConversationsTabProps {
  supportCases?: SupportCaseSummary[];
  supportLoading?: boolean;
  supportError?: string | null;
  conversations: BuyerConversation[];
  loading: boolean;
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

function lastAssistantOrUserPreview(msgs: ConversationMessage[]): string {
  if (!msgs || msgs.length === 0) return "";
  for (let i = msgs.length - 1; i >= 0; i--) {
    if (msgs[i].role === "assistant" || msgs[i].role === "agent") {
      return msgs[i].content;
    }
  }
  for (let i = msgs.length - 1; i >= 0; i--) {
    if (msgs[i].role === "user") {
      return msgs[i].content;
    }
  }
  return msgs[msgs.length - 1].content;
}

function isAssistant(role: ConversationMessage["role"]): boolean {
  return role === "assistant" || role === "agent";
}

function RoleBadge({ role }: { role: ConversationMessage["role"] }) {
  const isUser = role === "user";
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

function ConversationCard({
  conv,
  onRate,

}: {
  conv: BuyerConversation;
  onRate: ConversationsTabProps["onRate"];
}) {
  const [expanded, setExpanded] = useState(false);
  const baseId = useId();
  const panelId = `${baseId}-panel`;
  const buttonId = `${baseId}-button`;
  const preview = truncate(lastAssistantOrUserPreview(conv.messages || []), 60);
  const msgCount = conv.messages?.length ?? 0;

  const cardStyle: React.CSSProperties = {
    background: "var(--aacp-card)",
    border: "1px solid var(--aacp-line)",
    borderRadius: 12,
    overflow: "hidden",
  };

  const headerStyle: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    padding: "12px 14px",
    width: "100%",
    background: "transparent",
    border: "none",
    color: "var(--aacp-fg)",
    textAlign: "left",
    cursor: "pointer",
    font: "inherit",
  };

  const metaRowStyle: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    gap: 8,
    marginTop: 4,
    fontSize: 12,
    color: "var(--aacp-muted)",
  };

  const previewStyle: React.CSSProperties = {
    margin: "6px 0 0 0",
    fontSize: 13,
    color: "var(--aacp-muted)",
    lineHeight: 1.4,
  };

  const panelStyle: React.CSSProperties = {
    padding: expanded ? "0 14px 14px 14px" : "0 14px",
    maxHeight: expanded ? "1200px" : "0",
    overflow: "hidden",
    transition: "max-height 220ms ease, padding 220ms ease",
    borderTop: expanded ? "1px solid var(--aacp-line)" : "1px solid transparent",
  };

  const listStyle: React.CSSProperties = {
    listStyle: "none",
    margin: "12px 0 0 0",
    padding: 0,
    display: "flex",
    flexDirection: "column",
    gap: 10,
  };

  return (
    <li style={cardStyle} aria-label={`Conversa com ${conv.merchant_id}`}>
      <button data-neu="control"
        id={buttonId}
        type="button"
        aria-expanded={expanded}
        aria-controls={panelId}
        onClick={() => setExpanded((v) => !v)}
        style={headerStyle}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontSize: 14,
              fontWeight: 600,
              color: "var(--aacp-fg)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
            title={conv.merchant_id}
          >
            {conv.merchant_id}
          </div>
          <div style={metaRowStyle}>
            <span>Iniciada em {formatDate(conv.started_at)}</span>
            <span aria-hidden="true">·</span>
            <span>
              {msgCount} {msgCount === 1 ? "mensagem" : "mensagens"}
            </span>
          </div>
          {preview ? <p style={previewStyle}>{preview}</p> : null}
        </div>
        <FiChevronRight
          size={16}
          aria-hidden="true"
          style={{
            transform: expanded ? "rotate(90deg)" : "rotate(0deg)",
            transition: "transform 150ms ease",
            flexShrink: 0,
          }}
        />
      </button>
      <div
        id={panelId}
        role="region"
        aria-labelledby={buttonId}
        style={panelStyle}
      >
        {msgCount > 0 ? (
          <ul style={listStyle}>
            {conv.messages.map((m) => (
              <MessageBubble
                key={m.id}
                msg={m}
                conversationId={conv.id}
                onRate={onRate}
              />
            ))}
          </ul>
        ) : (
          <p
            style={{
              margin: "12px 0 0 0",
              fontSize: 13,
              color: "var(--aacp-muted)",
            }}
          >
            Sem mensagens nesta conversa.
          </p>
        )}
      </div>
    </li>
  );
}

export default function ConversationsTab({
  conversations,
  loading,
  onRate,
  supportCases = [], supportLoading = false, supportError,
}: ConversationsTabProps) {
  if (loading || supportLoading) {
    return (
      <div
        role="status"
        aria-live="polite"
        aria-busy="true"
        style={{
          padding: 24,
          color: "var(--aacp-muted)",
          fontSize: 14,
          textAlign: "center",
        }}
      >
        Carregando conversas…
      </div>
    );
  }

  const hasConversations = Boolean(conversations && conversations.length > 0);

  if (!hasConversations && supportCases.length === 0 && !supportError) {
    return (
      <div
        role="status"
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 12,
          padding: "48px 16px",
          textAlign: "center",
        }}
      >
        <div
          aria-hidden="true"
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: 56,
            height: 56,
            borderRadius: "50%",
            background: "var(--aacp-surface-3)",
            color: "var(--aacp-muted)",
          }}
        >
          <FiMessageSquare size={26} />
        </div>
        <div style={{ fontSize: 14, fontWeight: 600, color: "var(--aacp-fg)" }}>
          Nenhuma conversa
        </div>
        <div style={{ fontSize: 12, color: "var(--aacp-muted)", maxWidth: 260 }}>
          Suas conversas com a assistente e tickets de suporte aparecerão aqui.
        </div>
      </div>
    );
  }

  return (
    <section
      aria-label="Histórico de conversas"
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 12,
      }}
    >
      <ul
        style={{
          listStyle: "none",
          margin: 0,
          padding: 0,
          display: "flex",
          flexDirection: "column",
          gap: 12,
        }}
      >
        {supportError && <li role="alert" style={{ color: "var(--aacp-fg)", padding: 14 }}>{supportError}</li>}
        {supportCases.map(item => <li key={item.ticketId}><button data-neu="card" type="button" onClick={() => window.dispatchEvent(new CustomEvent("zyon:open-support", { detail: { ticketId: item.ticketId, merchantId: item.merchantId } }))} style={{ width: "100%", minHeight: 72, display: "flex", flexDirection: "column", gap: 6, padding: 16, border: "1px solid var(--aacp-line)", borderRadius: 12, background: "var(--aacp-card)", color: "var(--aacp-fg)", font: "inherit", cursor: "pointer", textAlign: "left" }}><strong>{item.kind === "refund" ? "Devolução" : item.kind === "exchange" ? "Troca" : "Atendimento"}{item.orderId ? ` · Pedido ${item.orderId}` : ""}</strong><span style={{ color: "var(--aacp-muted)", fontSize: 13 }}>{caseLabel(item)}{item.unreadCount > 0 ? ` · ${item.unreadCount} nova(s) mensagem(ns)` : ""}</span><span style={{ fontSize: 13 }}>{truncate(item.lastMessage?.content ?? "Abrir conversa", 120)}</span><span style={{ fontSize: 12, color: "var(--aacp-accent)" }}>Acompanhar conversa →</span></button></li>)}
        {conversations.map((c) => (
          <ConversationCard key={c.id} conv={c} onRate={onRate} />
        ))}
      </ul>
    </section>
  );
}
