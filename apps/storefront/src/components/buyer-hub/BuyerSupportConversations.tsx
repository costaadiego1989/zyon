"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import type { BuyerSupportInbox } from "@/lib/viewmodels/useBuyerSupportInbox";
import { fetchBuyerSupportDetail, readBuyerSupport, sendBuyerSupport, type BuyerSupportMessage } from "@/lib/services/buyer-support.service";

const cursorAfter = (message: BuyerSupportMessage) => btoa(JSON.stringify({ createdAt: message.createdAt, id: message.id })).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const date = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" });
const control = { padding: "10px 14px", borderRadius: 10, border: "1px solid var(--aacp-line)", background: "var(--aacp-card)", color: "var(--aacp-fg)", cursor: "pointer" };

function SupportChat({ ticketId, active, onRefresh, onBack }: { ticketId: string; active: boolean; onRefresh: () => Promise<void>; onBack: () => void }) {
  const [messages, setMessages] = useState<BuyerSupportMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [content, setContent] = useState("");
  const [sending, setSending] = useState(false);
  const messagesRef = useRef<BuyerSupportMessage[]>([]);
  const marked = useRef("");
  const refresh = useRef<() => Promise<void>>(async () => {});
  const pending = useRef<{ content: string; id: string }>();
  const bottom = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let cancelled = false; let fetching = false;
    messagesRef.current = []; marked.current = ""; setMessages([]); setLoading(true); setError(null);
    const load = async () => {
      if (fetching || document.visibilityState !== "visible") return;
      fetching = true;
      try {
        const last = messagesRef.current.at(-1);
        const detail = await fetchBuyerSupportDetail(ticketId, last ? cursorAfter(last) : undefined);
        if (cancelled) return;
        const merged = [...new Map([...messagesRef.current, ...detail.messages].map(message => [message.id, message])).values()];
        messagesRef.current = merged;
        if (detail.messages.length) setMessages(merged);
        setError(null);
      } catch { if (!cancelled) setError("Não foi possível atualizar as mensagens. Tente novamente."); }
      finally { fetching = false; if (!cancelled) setLoading(false); }
    };
    refresh.current = load;
    void load();
    const timer = window.setInterval(() => { void load(); }, 4000);
    document.addEventListener("visibilitychange", load);
    return () => { cancelled = true; window.clearInterval(timer); document.removeEventListener("visibilitychange", load); };
  }, [ticketId]);
  useEffect(() => {
    const last = messages.at(-1);
    if (!last || loading) return;
    bottom.current?.scrollIntoView({ block: "nearest" });
    let cancelled = false;
    let acknowledging = false;
    const acknowledge = async () => {
      if (cancelled || acknowledging || marked.current === last.id || document.visibilityState !== "visible") return;
      acknowledging = true;
      try {
        await readBuyerSupport(ticketId, last.id);
        if (!cancelled) { marked.current = last.id; void onRefresh(); }
      } catch { /* Keep unread state until the server accepts this rendered message. */ }
      finally { acknowledging = false; }
    };
    void acknowledge();
    const timer = window.setInterval(() => { void acknowledge(); }, 4000);
    document.addEventListener("visibilitychange", acknowledge);
    return () => { cancelled = true; window.clearInterval(timer); document.removeEventListener("visibilitychange", acknowledge); };
  }, [messages, loading, ticketId, onRefresh]);
  const send = async (event: FormEvent) => {
    event.preventDefault();
    const text = content.trim(); if (!text || sending) return;
    if (pending.current?.content !== text) pending.current = { content: text, id: crypto.randomUUID() };
    setSending(true); setError(null);
    try { await sendBuyerSupport(ticketId, text, pending.current.id); pending.current = undefined; setContent(""); await refresh.current(); await onRefresh(); }
    catch { setError("Não foi possível enviar. Seu texto foi mantido para tentar novamente."); }
    finally { setSending(false); }
  };
  return <section aria-label="Mensagens com a equipe da loja" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
    <button type="button" data-neu="control" onClick={onBack} style={{ ...control, alignSelf: "flex-start" }}>← Todos os atendimentos</button>
    <div><h3 style={{ margin: 0, fontSize: 16 }}>Conversa com a loja</h3><p style={{ margin: "5px 0 0", color: "var(--aacp-muted)", fontSize: 13 }}>As respostas da equipe ficam salvas aqui.</p></div>
    {loading && <p role="status">Carregando mensagens…</p>}
    <div role="log" aria-label="Histórico do atendimento" aria-live="polite" style={{ display: "flex", flexDirection: "column", gap: 10, maxHeight: 420, overflowY: "auto", padding: 4 }}>
      {messages.map(message => <div key={message.id} data-neu="inset" style={{ maxWidth: "92%", alignSelf: message.senderType === "buyer" ? "flex-end" : "flex-start", padding: "12px 14px", border: "1px solid var(--aacp-line)", borderRadius: 12, background: "var(--aacp-surface-2)", overflowWrap: "anywhere" }}>
        <strong style={{ fontSize: 12 }}>{message.senderType === "buyer" ? "Você" : message.senderType === "merchant" ? "Equipe da loja" : "Atualização do atendimento"}</strong>
        <p style={{ margin: "6px 0", whiteSpace: "pre-wrap", fontSize: 14, lineHeight: 1.5 }}>{message.content}</p>
        <time dateTime={message.createdAt} style={{ color: "var(--aacp-muted)", fontSize: 11 }}>{date.format(new Date(message.createdAt))}</time>
      </div>)}<div ref={bottom} />
    </div>
    {error && <div role="alert"><p>{error}</p><button type="button" data-neu="control" style={control} onClick={() => { void refresh.current(); }}>Tentar novamente</button></div>}
    {active ? <form onSubmit={send} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <label htmlFor={`support-message-${ticketId}`} style={{ fontSize: 13 }}>Sua mensagem para a loja</label>
      <textarea id={`support-message-${ticketId}`} value={content} onChange={event => setContent(event.target.value)} maxLength={4000} rows={3} style={{ ...control, resize: "vertical", cursor: "text" }} />
      <button type="submit" data-neu="control" disabled={sending || !content.trim()} style={{ ...control, alignSelf: "flex-end", opacity: sending || !content.trim() ? 0.5 : 1 }}>{sending ? "Enviando…" : "Enviar mensagem"}</button>
    </form> : <p role="status" style={{ color: "var(--aacp-muted)", fontSize: 13 }}>Este atendimento foi encerrado. O histórico continua disponível.</p>}
  </section>;
}

export function BuyerSupportConversations({ inbox }: { inbox: BuyerSupportInbox }) {
  const [selected, setSelected] = useState<string | null>(null);
  const ticket = inbox.items.find(item => item.ticketId === selected);
  if (ticket) return <SupportChat key={ticket.ticketId} ticketId={ticket.ticketId} active={ticket.active} onRefresh={inbox.refresh} onBack={() => setSelected(null)} />;
  if (!inbox.items.length && !inbox.error) return null;
  return <section aria-label="Atendimentos com a loja" style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 22 }}>
    <h3 style={{ margin: 0, fontSize: 16 }}>Mensagens da loja</h3>
    <p style={{ margin: "0 0 4px", color: "var(--aacp-muted)", fontSize: 13 }}>Acompanhe os atendimentos e responda à equipe por aqui.</p>
    {inbox.error && <div role="alert">{inbox.error} <button type="button" onClick={() => { void inbox.refresh(); }} style={control}>Tentar novamente</button></div>}
    {inbox.items.map(item => <button key={item.ticketId} type="button" data-neu="control" onClick={() => setSelected(item.ticketId)} aria-label={`Abrir atendimento ${item.ticketId.slice(-6)}${item.unreadCount ? ", resposta não lida" : ""}`} style={{ ...control, textAlign: "left", display: "flex", flexDirection: "column", gap: 6 }}>
      <span style={{ display: "flex", justifyContent: "space-between", gap: 12 }}><strong>{item.kind === "support" ? "Atendimento da loja" : "Atendimento do pedido"}</strong>{item.unreadCount > 0 && <span aria-label="Conversa não lida" style={{ color: "var(--aacp-accent)", fontWeight: 700 }}>1 nova</span>}</span>
      <span style={{ fontSize: 13, color: "var(--aacp-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.lastMessage?.content || "Seu atendimento foi aberto. Aguarde a resposta da equipe."}</span>
      <span style={{ fontSize: 11, color: "var(--aacp-muted)" }}>{item.active ? "Em atendimento" : "Encerrado"} · {date.format(new Date(item.updatedAt))}</span>
    </button>)}
  </section>;
}
