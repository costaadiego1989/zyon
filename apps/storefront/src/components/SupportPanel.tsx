"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Socket } from "socket.io-client";
import { getValidBuyer } from "@/lib/buyer-auth";
import { useSupportInbox } from "@/lib/hooks/useSupportInbox";
import { apiCall, API_BASE } from "@/lib/services/http";
import { fetchPublicFaq, type FaqItem } from "@/lib/services/support.service";
import { caseLabel, evidenceUrl, getSupportCase, openGenericCase, readSupportCase, rememberSupportTicket, sendCaseMessage, supportChanged, type SupportCaseDetail } from "@/lib/services/support-case.service";
import { ReturnRequestForm } from "./ReturnRequestForm";
import { SupportPhotoPicker } from "./SupportPhotoPicker";
import styles from "./SupportFlow.module.css";

export interface SupportTarget { ticketId?: string; orderId?: string; view?: "return"; intent?: "cancel"; merchantId?: string; }
export default function SupportPanel({ open, onClose, merchantId, agentName, target }: { open: boolean; onClose: () => void; merchantId?: string; agentName?: string; target?: SupportTarget }) {
  const [view, setView] = useState<"welcome" | "return" | "chat" | "faq">("welcome");
  const [ticketId, setTicketId] = useState<string>();
  const [detail, setDetail] = useState<SupportCaseDetail | null>(null);
  const [faq, setFaq] = useState<FaqItem[]>([]);
  const [answer, setAnswer] = useState<FaqItem | null>(null);
  const [input, setInput] = useState("");
  const [images, setImages] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [readingImages, setReadingImages] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const request = useRef(0);
  const messageKey = useRef<string>();
  const lastRead = useRef<string>();
  const bottom = useRef<HTMLDivElement>(null);
  const conversation = useRef<HTMLElement>(null);
  const nearBottom = useRef(true);
  const [newMessages, setNewMessages] = useState(false);
  const panel = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose); closeRef.current = onClose;
  const scope = target?.merchantId ?? merchantId;
  const inbox = useSupportInbox(scope, open);
  const buyer = getValidBuyer();
  const identity = buyer?.globalUserId;
  useEffect(() => { if (merchantId) void fetchPublicFaq(merchantId).then(setFaq); }, [merchantId]);
  useEffect(() => { setTicketId(undefined); setDetail(null); setInput(""); setImages([]); setView("welcome"); messageKey.current = undefined; }, [identity, merchantId]);
  useEffect(() => {
    if (!open) return;
    setError(null);
    if (target?.ticketId) { setTicketId(target.ticketId); setView("chat"); }
    else if (target?.view === "return" || target?.orderId) setView("return");
  }, [open, target, identity]);
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    panel.current?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeRef.current();
      if (event.key !== "Tab") return;
      const targets = Array.from(panel.current?.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], input:not(:disabled):not([hidden]), textarea:not(:disabled), [tabindex="0"]') ?? []).filter(element => element.getClientRects().length > 0);
      const first = targets[0], last = targets[targets.length - 1];
      if (event.shiftKey && (document.activeElement === first || document.activeElement === panel.current)) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    window.addEventListener("keydown", keydown);
    return () => { window.removeEventListener("keydown", keydown); previous?.focus(); };
  }, [open]);
  const refresh = useCallback(async () => {
    if (!ticketId || !getValidBuyer()) return;
    const current = ++request.current;
    try { const data = await getSupportCase(ticketId); if (current === request.current) { setDetail(data); rememberSupportTicket(data.ticketId); if (data.ticketId !== ticketId) setTicketId(data.ticketId); } }
    catch (e) { if (current === request.current) setError(e instanceof Error ? e.message : "Não foi possível carregar a conversa."); }
    finally { if (current === request.current) setLoading(false); }
  }, [ticketId]);
  useEffect(() => {
    if (!open || view !== "chat" || !ticketId || !identity) return;
    setDetail(null); setLoading(true); lastRead.current = undefined; nearBottom.current = true; setNewMessages(false);
    void refresh();
    const update = () => { if (!document.hidden) void refresh(); };
    const interval = window.setInterval(update, 5000);
    window.addEventListener("focus", update);
    let socket: Socket | undefined, renewal: ReturnType<typeof setTimeout> | undefined, cancelled = false;
    async function connect() {
      try {
        const access = await apiCall<{ token: string; expiresAt: number }>(`/buyer/support/tickets/${encodeURIComponent(ticketId!)}/realtime`, { method: "POST" });
        const { io } = await import("socket.io-client");
        if (cancelled) return;
        socket?.disconnect();
        const socketOrigin = process.env.NEXT_PUBLIC_API_WEBSOCKET_ORIGIN || (API_BASE.startsWith("/") ? "https://api.zyon-payments.com.br" : new URL(API_BASE).origin);
        socket = io(`${socketOrigin}/support`, { auth: { ticketToken: access.token }, transports: ["websocket", "polling"] });
        socket.on("authenticated", () => { socket?.emit("join_ticket", { ticketId }); update(); });
        socket.on("new_message", update); socket.on("case_updated", update); socket.on("ticket_closed", update);
        renewal = setTimeout(() => { void connect(); }, Math.max(1000, access.expiresAt * 1000 - Date.now() - 60000));
      } catch { /* The persisted conversation continues to synchronize over HTTP. */ }
    }
    void connect();
    return () => { cancelled = true; request.current++; socket?.disconnect(); clearTimeout(renewal); window.clearInterval(interval); window.removeEventListener("focus", update); };
  }, [open, view, ticketId, identity, refresh]);
  const lastMessage = detail?.messages.at(-1)?.id;
  useEffect(() => {
    if (!open || view !== "chat" || !detail || !lastMessage) return;
    const marker = bottom.current, root = conversation.current;
    if (!marker || !root) return;
    if (nearBottom.current) marker.scrollIntoView({ block: "nearest", behavior: "instant" });
    else setNewMessages(true);
    const acknowledge = () => {
      const rect = marker.getBoundingClientRect(), bounds = root.getBoundingClientRect();
      // Fractional layout coordinates can place the 1 px marker a fraction of
      // a pixel past the viewport after scrollIntoView reaches the bottom.
      if (document.hidden || rect.top < bounds.top - 1 || rect.bottom > bounds.bottom + 1 || lastRead.current === lastMessage) return;
      setNewMessages(false);
      void readSupportCase(detail.ticketId, lastMessage).then(() => { lastRead.current = lastMessage; supportChanged(); }).catch(() => undefined);
    };
    const observer = new IntersectionObserver(entries => { if (entries[0]?.isIntersecting) acknowledge(); }, { root, threshold: 0 });
    observer.observe(marker); window.addEventListener("focus", acknowledge);
    return () => { observer.disconnect(); window.removeEventListener("focus", acknowledge); };
  }, [open, view, lastMessage, detail?.ticketId]);
  function showCase(id: string) { if (sending) return; setTicketId(id); setView("chat"); setInput(""); setImages([]); messageKey.current = undefined; }
  function login() { onClose(); window.dispatchEvent(new Event("zyon:open-buyer-hub")); }
  async function send() {
    if (sending || readingImages || !scope || (!input.trim() && !images.length) || !buyer) return;
    const text = input.trim();
    const id = messageKey.current ?? crypto.randomUUID(); messageKey.current = id;
    setSending(true); setError(null);
    try {
      if (view === "chat" && ticketId) await sendCaseMessage(ticketId, text, images, id);
      else {
        const existing = inbox.items.find(item => item.kind === "support" && item.active && item.merchantId === scope);
        const result = existing ? { ticketId: existing.ticketId } : await openGenericCase(scope, text || "Enviei fotos para a análise da loja.", id);
        if (existing) await sendCaseMessage(result.ticketId, text, images, id);
        else if (images.length) await sendCaseMessage(result.ticketId, "Fotos da solicitação", images, `${id}_photos`);
        setTicketId(result.ticketId); setView("chat");
      }
      setInput(""); setImages([]); messageKey.current = undefined; supportChanged(); await refresh();
    } catch (e) { setError(e instanceof Error ? e.message : "Não foi possível enviar. Tente novamente."); }
    finally { setSending(false); }
  }
  if (!open) return null;
  return <><div className={styles.backdrop} onClick={onClose} aria-hidden="true" /><div data-neu="overlay" id="support-panel" className={styles.panel} ref={panel} role="dialog" aria-modal="true" aria-labelledby="support-title" tabIndex={-1}>
    <header className={styles.header}>{view !== "welcome" && <button className={styles.icon} disabled={sending} onClick={() => setView("welcome")} aria-label="Voltar ao menu de suporte">←</button>}<div className={styles.headerTitle}><strong id="support-title">{view === "chat" ? "Conversa com a loja" : "Como podemos ajudar?"}</strong><span className={styles.muted}>{view === "return" ? "Troca e devolução" : `${agentName || "Assistente"} · Central de ajuda`}</span></div><button className={styles.icon} disabled={sending} onClick={onClose} aria-label="Fechar suporte">×</button></header>
    {view === "chat" && detail && <div className={styles.context}><div className={styles.row}><span className={styles.badge}>{caseLabel(detail)}</span><span>Chamado #{detail.ticketId.slice(-6).toUpperCase()}</span></div>{detail.orderId && <details><summary style={{ paddingTop: 8, cursor: "pointer" }}>Pedido {detail.orderId}</summary><p>{detail.selectedItems.map(item => `${item.quantity} × ${item.name}`).join(" · ")}</p><p className={styles.muted}>{detail.reasonLabel}</p>{detail.order?.trackingCode && <p>Rastreio: {detail.order.trackingCode}</p>}</details>}</div>}
    <main className={styles.body} ref={conversation} onScroll={event => { const el = event.currentTarget; nearBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60; }}><div className={styles.stack}>
      {view === "return" && (buyer && scope ? <ReturnRequestForm initialIntent={target?.intent} merchantId={scope} orderId={target?.orderId} cases={inbox.items} onSuccess={showCase} onCancel={() => setView("welcome")} /> : <><p className={styles.question}>Entre para escolher o pedido e os itens.</p><p className={styles.muted}>Sua conta mantém a solicitação e as respostas da loja disponíveis quando você voltar.</p><button className={`${styles.button} ${styles.primary}`} onClick={login}>Entrar na minha conta</button></>)}
      {view === "welcome" && <><p className={styles.question}>Vamos resolver juntos.</p><p className={styles.muted}>Escolha um assunto ou escreva para a loja. Seus atendimentos e respostas ficam disponíveis na sua conta.</p>{inbox.loading && buyer && <p role="status" className={styles.muted}>Consultando seus atendimentos…</p>}{inbox.error && <p className={styles.error} role="alert">{inbox.error}</p>}{inbox.items.filter(item => item.active).map(item => <button key={item.ticketId} className={`${styles.choice} ${styles.caseButton}`} onClick={() => showCase(item.ticketId)}><strong>{item.kind === "refund" ? "Devolução em andamento" : item.kind === "exchange" ? "Troca em andamento" : "Atendimento em andamento"}</strong><span className={styles.muted}>{item.orderId ? `Pedido ${item.orderId}` : "Conversa com a loja"}</span><span className={styles.badge}>{item.unreadCount ? `${item.unreadCount} nova(s) mensagem(ns)` : caseLabel(item)}</span></button>)}<button className={`${styles.button} ${styles.primary}`} onClick={() => setView("return")}>Cancelar, trocar ou devolver</button>{faq.filter(item => !/atendente|humano/i.test(item.question)).map(item => <button key={item.question} className={styles.choice} onClick={() => { setAnswer(item); setView("faq"); }}>{item.question}</button>)}{inbox.items.some(item => !item.active) && <><strong>Atendimentos concluídos</strong>{inbox.items.filter(item => !item.active).map(item => <button className={styles.choice} key={item.ticketId} onClick={() => showCase(item.ticketId)}><strong>{item.orderId ? `Pedido ${item.orderId}` : `Chamado #${item.ticketId.slice(-6)}`}</strong><span className={styles.muted}>{caseLabel(item)}</span></button>)}</>}</>}
      {view === "faq" && answer && <><div className={`${styles.bubble} ${styles.answer}`}>{answer.question}</div><div className={styles.bubble}>{answer.answer}</div><p className={styles.muted}>Ainda precisa de ajuda? Escreva abaixo para conversar com a loja.</p></>}
      {view === "chat" && <>{loading && <p className={styles.muted} role="status">Carregando a conversa…</p>}{detail?.messages.map(message => message.senderType === "system" ? <div className={styles.system} key={message.id}>{message.content}<time className={styles.time}>{new Date(message.createdAt).toLocaleString("pt-BR")}</time></div> : <div key={message.id} className={`${styles.bubble} ${message.senderType === "buyer" ? styles.answer : ""}`}><span className={styles.label}>{message.senderType === "buyer" ? "Você" : "Atendente da loja"}</span>{message.content}{Array.isArray(message.metadata?.imageUrls) && <div className={styles.photos}>{message.metadata.imageUrls.map((url, index) => <a className={styles.evidence} key={url} href={evidenceUrl(url)} target="_blank" rel="noreferrer"><img src={evidenceUrl(url)} alt={`Foto enviada ${index + 1}`} loading="lazy" /></a>)}</div>}<time className={styles.time}>{new Date(message.createdAt).toLocaleString("pt-BR")}</time></div>)}<div ref={bottom} style={{ minHeight: 1 }} /></>}
      {error && <div className={styles.error} role="alert">{error}{view === "chat" && <button className={styles.button} onClick={() => void refresh()}>Atualizar conversa</button>}</div>}
    </div></main>
    {view === "chat" && newMessages && <button className={styles.button} onClick={() => bottom.current?.scrollIntoView({ block: "nearest", behavior: "smooth" })}>Ver novas mensagens</button>}
    {view !== "return" && <div className={styles.composer}>{view === "chat" && detail && !detail.active ? <p className={styles.muted}>Este atendimento foi concluído. O histórico continua disponível na sua conta.</p> : !buyer ? <button className={styles.button} onClick={login}>Entrar para conversar com a loja</button> : <form className={styles.stack} onSubmit={event => { event.preventDefault(); void send(); }}><label className={styles.label} htmlFor="support-message">{view === "chat" ? "Sua mensagem à loja" : "Fale com a loja"}</label><textarea id="support-message" className={styles.textarea} rows={2} maxLength={4000} value={input} disabled={sending} onChange={event => { setInput(event.target.value); messageKey.current = undefined; }} placeholder="Escreva sua mensagem…" /><SupportPhotoPicker compact onReadingChange={setReadingImages} images={images} onChange={value => { setImages(value); messageKey.current = undefined; }} disabled={sending} /><button className={`${styles.button} ${styles.primary}`} type="submit" disabled={sending || readingImages || !scope || (!input.trim() && !images.length) || (view === "chat" && (!detail || loading))}>{sending ? "Enviando…" : "Enviar mensagem"}</button></form>}</div>}
  </div></>;
}
