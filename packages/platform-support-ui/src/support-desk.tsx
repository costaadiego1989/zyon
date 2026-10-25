import React, { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import type { PlatformSupportCapabilities, PlatformSupportCategory, PlatformSupportConversation, PlatformSupportNote, PlatformSupportQuery, PlatformSupportSeverity, PlatformSupportStatus, PlatformSupportTicket } from "@zyon/shared-types";
import { platformSupportError, type PlatformSupportClient, type SupportConnectionState } from "./client.js";
import "./styles.css";

const statusLabels: Record<PlatformSupportStatus, string> = { open: "Aberto", in_progress: "Em atendimento", waiting_customer: "Aguardando cliente", resolved: "Resolvido" };
const severityLabels: Record<PlatformSupportSeverity, string> = { normal: "Normal", high: "Alta", critical: "Crítica" };
const categories: Record<PlatformSupportCategory, string> = { bug: "Bug ou erro", improvement: "Melhoria", suggestion: "Sugestão", other: "Outro assunto" };
const dateTime = (value: string) => new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(new Date(value));

export function PlatformSupportDesk({ client, operatorId, operators = [], startNew = false, onUnauthorized }: {
  client: PlatformSupportClient;
  operatorId?: string;
  operators?: Array<{ id: string; label: string }>;
  startNew?: boolean;
  onUnauthorized?: () => void;
}) {
  const [items, setItems] = useState<PlatformSupportTicket[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [conversation, setConversation] = useState<PlatformSupportConversation | null>(null);
  const [capabilities, setCapabilities] = useState<PlatformSupportCapabilities | null>(null);
  const [notes, setNotes] = useState<PlatformSupportNote[]>([]);
  const [state, setState] = useState<SupportConnectionState>("connecting");
  const [revision, setRevision] = useState(0);
  const [status, setStatus] = useState<PlatformSupportStatus | "">("");
  const [search, setSearch] = useState("");
  const [searchFilter, setSearchFilter] = useState("");
  const [mine, setMine] = useState(false);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [moreLoading, setMoreLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [showNew, setShowNew] = useState(startNew);
  const [draft, setDraft] = useState("");
  const [noteDraft, setNoteDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [updating, setUpdating] = useState(false);
  const selectedRef = useRef(selected);
  const drafts = useRef(new Map<string, { content: string; id: string }>());
  const noteRequests = useRef(new Map<string, { content: string; id: string }>());
  const history = useRef<HTMLDivElement>(null);
  const previousLast = useRef(0);
  const followLatest = useRef(true);
  selectedRef.current = selected;
  const operator = client.kind === "operator";
  const refresh = useCallback(() => setRevision(value => value + 1), []);
  const report = useCallback((caught: unknown) => {
    if (caught && typeof caught === "object" && "status" in caught && caught.status === 401) onUnauthorized?.();
    return platformSupportError(caught);
  }, [onUnauthorized]);

  useEffect(() => { const timer = setTimeout(() => setSearchFilter(search.trim()), 250); return () => clearTimeout(timer); }, [search]);
  useEffect(() => {
    const unsubscribe = client.subscribe({ changed: refresh, state: setState });
    // Reconcile after missed invalidations and temporary Redis interruption.
    const timer = setInterval(refresh, 30_000);
    const visible = () => { if (document.visibilityState === "visible") refresh(); };
    document.addEventListener("visibilitychange", visible);
    return () => { unsubscribe(); clearInterval(timer); document.removeEventListener("visibilitychange", visible); };
  }, [client, refresh]);

  useEffect(() => {
    if (operator) return;
    let active = true;
    void client.capabilities().then(value => { if (active) setCapabilities(value); }).catch(caught => { if (active) setError(report(caught)); });
    return () => { active = false; };
  }, [client, operator, report, revision]);

  useEffect(() => {
    let active = true;
    setError(null);
    const query: PlatformSupportQuery = { ...(status ? { status } : {}), ...(searchFilter ? { search: searchFilter } : {}), mine };
    void client.list(query).then(page => {
      if (!active) return;
      setItems(page.items);
      setCursor(page.nextCursor);
    }).catch(caught => { if (active) setError(report(caught)); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [client, status, searchFilter, mine, revision, report]);

  useEffect(() => {
    setConversation(null);
    setNotes([]);
    setDetailError(null);
    setActionError(null);
    setDraft(selected ? drafts.current.get(selected)?.content ?? "" : "");
    setNoteDraft(selected ? noteRequests.current.get(selected)?.content ?? "" : "");
    previousLast.current = 0;
  }, [selected]);

  useEffect(() => {
    if (!selected || showNew) return;
    let active = true;
    setDetailLoading(true);
    void Promise.all([client.conversation(selected), operator ? client.notes(selected) : Promise.resolve([])]).then(([detail, internalNotes]) => {
      if (!active) return;
      const box = history.current;
      followLatest.current = !box || box.scrollHeight - box.scrollTop - box.clientHeight < 100;
      setConversation(current => {
        if (!current || current.ticket.id !== detail.ticket.id) return detail;
        const earliestLoaded = current.messages[0]?.sequence ?? Infinity;
        const earliestFresh = detail.messages[0]?.sequence ?? Infinity;
        const messages = new Map([...current.messages, ...detail.messages].map(message => [message.sequence, message]));
        return { ...detail, messages: [...messages.values()].sort((a, b) => a.sequence - b.sequence), hasMore: earliestLoaded < earliestFresh ? current.hasMore : detail.hasMore };
      });
      setNotes(internalNotes);
      setDetailError(null);
      if (document.visibilityState === "visible" && followLatest.current) {
        void client.read(selected, detail.ticket.lastMessageSequence).then(() => {
          if (active) setItems(current => current.map(ticket => ticket.id === selected ? { ...ticket, unreadCount: 0 } : ticket));
        }).catch(caught => { if (active) setDetailError(report(caught)); });
      }
    }).catch(caught => { if (active) setDetailError(report(caught)); }).finally(() => { if (active) setDetailLoading(false); });
    return () => { active = false; };
  }, [client, selected, showNew, revision, operator, report]);

  useEffect(() => {
    const last = conversation?.ticket.lastMessageSequence ?? 0;
    if (last > previousLast.current && history.current && followLatest.current) history.current.scrollTop = history.current.scrollHeight;
    previousLast.current = last;
  }, [conversation]);

  function select(ticketId: string) { setSelected(ticketId); setShowNew(false); }
  function updateDraft(content: string) {
    setDraft(content);
    if (selected) drafts.current.set(selected, { content, id: crypto.randomUUID() });
  }

  async function send(event: FormEvent) {
    event.preventDefault();
    if (!selected || !draft.trim() || sending) return;
    const ticketId = selected;
    const pending = drafts.current.get(ticketId) ?? { content: draft, id: crypto.randomUUID() };
    drafts.current.set(ticketId, pending);
    setSending(true); setActionError(null);
    try {
      await client.send(ticketId, { content: pending.content.trim(), clientMessageId: pending.id });
      drafts.current.delete(ticketId);
      if (selectedRef.current === ticketId) setDraft("");
      refresh();
    } catch (caught) { if (selectedRef.current === ticketId) setActionError(report(caught)); }
    finally { setSending(false); }
  }

  async function changeTreatment(input: Parameters<PlatformSupportClient["treat"]>[1]) {
    if (!selected) return;
    const ticketId = selected;
    setUpdating(true); setActionError(null);
    try { const detail = await client.treat(ticketId, input); if (selectedRef.current === ticketId) setConversation(detail); refresh(); }
    catch (caught) { if (selectedRef.current === ticketId) setActionError(report(caught)); }
    finally { setUpdating(false); }
  }

  async function reopen() {
    if (!selected) return;
    setUpdating(true); setActionError(null);
    try { await client.reopen(selected); refresh(); } catch (caught) { setActionError(report(caught)); } finally { setUpdating(false); }
  }

  async function addNote(event: FormEvent) {
    event.preventDefault();
    if (!selected || !noteDraft.trim()) return;
    const ticketId = selected;
    const pending = noteRequests.current.get(ticketId) ?? { content: noteDraft, id: crypto.randomUUID() };
    noteRequests.current.set(ticketId, pending);
    setUpdating(true); setActionError(null);
    try {
      const updated = await client.addNote(ticketId, pending.content.trim(), pending.id);
      noteRequests.current.delete(ticketId);
      if (selectedRef.current === ticketId) { setNoteDraft(""); setNotes(updated); }
    } catch (caught) { if (selectedRef.current === ticketId) setActionError(report(caught)); }
    finally { setUpdating(false); }
  }

  async function moreTickets() {
    if (!cursor) return;
    setMoreLoading(true);
    try { const page = await client.list({ ...(status ? { status } : {}), search: searchFilter, mine, cursor }); setItems(current => [...current, ...page.items.filter(ticket => !current.some(item => item.id === ticket.id))]); setCursor(page.nextCursor); }
    catch (caught) { setError(report(caught)); } finally { setMoreLoading(false); }
  }

  async function olderMessages() {
    if (!selected || !conversation?.messages[0]) return;
    const ticketId = selected;
    setMoreLoading(true);
    try {
      const older = await client.conversation(ticketId, conversation.messages[0].sequence);
      if (selectedRef.current === ticketId) setConversation(current => current ? { ...current, messages: [...older.messages, ...current.messages.filter(message => !older.messages.some(item => item.id === message.id))], hasMore: older.hasMore } : current);
    } catch (caught) { setActionError(report(caught)); } finally { setMoreLoading(false); }
  }

  const ticket = conversation?.ticket;
  return <section className="ps-desk" data-selected={Boolean(selected || showNew)} aria-label="Central de atendimento técnico">
    <div className="ps-topbar"><div><h2>{operator ? "Converse com seus clientes" : "Meus chamados"}</h2><p className="ps-availability">{operator ? "Incidentes críticos primeiro. Escala tem prioridade entre casos de mesma gravidade." : capabilities?.availability ?? "Acompanhe as respostas da equipe técnica."}</p></div><div className="ps-actions"><span className="ps-connection" role="status"><i className="ps-dot" data-connected={state === "connected"} aria-hidden="true" />{state === "connected" ? "Conectado em tempo real" : state === "connecting" ? "Reconectando…" : "Reconectando; atualização periódica ativa"}</span><button className="ps-button" type="button" onClick={refresh}>Atualizar</button>{!operator && capabilities?.canOpen && <button className="ps-button ps-button--primary" type="button" onClick={() => { setShowNew(true); setActionError(null); }}>Abrir chamado</button>}</div></div>
    {error && <div className="ps-alert" role="alert">{error}<button type="button" className="ps-button" onClick={refresh}>Tentar novamente</button></div>}
    <div className={`ps-layout${operator ? "" : " ps-layout--merchant"}`}>
      <aside className="ps-queue" aria-label="Fila de chamados"><div className="ps-filters"><label className="ps-field">Buscar chamado<input value={search} onChange={event => setSearch(event.target.value)} placeholder="Assunto ou protocolo" maxLength={160} /></label><label className="ps-field">Situação<select value={status} onChange={event => setStatus(event.target.value as typeof status)}><option value="">Todas as situações</option>{Object.entries(statusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>{operator && <label className="ps-check"><input type="checkbox" checked={mine} onChange={event => setMine(event.target.checked)} />Meus atendimentos</label>}</div><div className="ps-ticket-list">{loading ? <div className="ps-skeleton" aria-label="Carregando chamados" aria-busy="true"><span /><span /><span /></div> : !items.length ? <div className="ps-empty"><strong>Nenhum chamado nesta fila</strong>Ajuste os filtros ou abra um novo atendimento.</div> : items.map(item => <button key={item.id} className="ps-ticket" type="button" onClick={() => select(item.id)} aria-pressed={selected === item.id}><span className="ps-ticket-meta"><span>{operator ? item.merchantName : categories[item.category]}</span>{item.unreadCount > 0 && <span className="ps-unread" aria-label={`${item.unreadCount} mensagens não lidas`}>{item.unreadCount}</span>}</span><strong>{item.subject}</strong><span className="ps-ticket-meta"><span>{statusLabels[item.status]}</span><span className={`ps-tier${item.tier === "priority" ? " ps-tier--priority" : ""}`}>{item.tier === "priority" ? "Escala · prioritário" : "Fila normal"}</span></span></button>)}</div>{cursor && <button className="ps-button ps-load-more" type="button" onClick={() => void moreTickets()} disabled={moreLoading}>Carregar mais chamados</button>}</aside>
      <div className="ps-conversation">
        {showNew && !operator ? <NewTicket client={client} allowed={capabilities?.canOpen === true} onCancel={() => setShowNew(false)} onCreated={detail => { select(detail.ticket.id); setConversation(detail); refresh(); }} /> : !selected ? <div className="ps-empty"><strong>Uma conversa para resolver o que aconteceu.</strong>Selecione um chamado para acompanhar o histórico.{!operator && capabilities && !capabilities.canOpen && <p>O chat técnico está incluído no Growth e no Escala. O formulário de feedback continua disponível.</p>}</div> : <>
          <header className="ps-conversation-header">
            <button className="ps-button ps-back" type="button" onClick={() => setSelected(null)}>← Voltar à fila</button>
            <ProtocolReference key={selected} value={selected} />
            <h3>{ticket?.subject ?? "Carregando conversa…"}</h3>
            {ticket && <span className="ps-connection">{statusLabels[ticket.status]} · {ticket.assignedOperatorName ?? "Aguardando atribuição"}</span>}
          </header>
          {detailError && <div className="ps-alert" role="alert">{detailError}<button className="ps-button" type="button" onClick={refresh}>Tentar novamente</button></div>}
          <div className="ps-history" ref={history} role="log" aria-label="Mensagens do chamado" aria-live="polite" aria-busy={detailLoading}>{conversation?.hasMore && <button className="ps-button ps-load-more" type="button" onClick={() => void olderMessages()} disabled={moreLoading}>Carregar mensagens anteriores</button>}{!conversation && detailLoading && <div className="ps-skeleton"><span /><span /></div>}{conversation?.messages.map(message => <article className={`ps-message${message.sender === client.kind ? " ps-message--self" : ""}`} key={message.id}><div className="ps-message-meta"><strong>{message.sender === client.kind ? operator ? "Equipe Zyon" : "Sua loja" : message.senderName}</strong><time dateTime={message.createdAt}>{dateTime(message.createdAt)}</time></div><div className="ps-message-body">{message.content}</div>{message.sender === client.kind && <span className="ps-read">{conversation.peerReadSequence >= message.sequence ? "Lida" : "Enviada"}</span>}</article>)}</div>
          {actionError && <div className="ps-alert" role="alert">{actionError}</div>}
          {ticket?.status === "resolved" ? <div className="ps-composer"><p className="ps-hint">Chamado resolvido. O histórico permanece disponível.</p>{(operator || capabilities?.canOpen) && <button className="ps-button" type="button" onClick={() => void reopen()} disabled={updating}>Reabrir chamado</button>}</div> : <form className="ps-composer" onSubmit={event => void send(event)}><label className="ps-field">{operator ? "Resposta ao cliente" : "Sua mensagem"}<textarea value={draft} onChange={event => updateDraft(event.target.value)} maxLength={4000} rows={3} disabled={sending || !ticket} placeholder="Descreva o que precisa ou continue a conversa." /></label><div className="ps-composer-footer"><small>{draft.length}/4000 · Evite senhas e dados de pagamento.</small><button className="ps-button ps-button--primary" type="submit" disabled={sending || !draft.trim() || !ticket}>{sending ? "Enviando…" : "Enviar mensagem"}</button></div></form>}
        </>}
      </div>
      {operator && <aside className="ps-context" aria-label="Contexto e tratamento interno">{ticket ? <><h3>Contexto do chamado</h3><dl className="ps-facts"><div><dt>Empresa</dt><dd>{ticket.merchantName}</dd></div><div><dt>Atendimento</dt><dd>{ticket.tier === "priority" ? "Escala · prioritário" : "Fila normal"}</dd></div><div><dt>Categoria</dt><dd>{categories[ticket.category]}</dd></div><div><dt>Aberto em</dt><dd>{dateTime(ticket.createdAt)}</dd></div>{ticket.waitingSince && <div><dt>Aguardando desde</dt><dd>{dateTime(ticket.waitingSince)}</dd></div>}<div><dt>Primeira resposta</dt><dd>{ticket.firstResponseAt ? dateTime(ticket.firstResponseAt) : "Ainda sem resposta"}</dd></div></dl><div className="ps-treatment"><label className="ps-field">Situação<select value={ticket.status} disabled={updating} onChange={event => void changeTreatment({ status: event.target.value as PlatformSupportStatus })}>{Object.entries(statusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label className="ps-field">Gravidade validada pela equipe<select value={ticket.severity} disabled={updating} onChange={event => void changeTreatment({ severity: event.target.value as PlatformSupportSeverity })}>{Object.entries(severityLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>{operators.length ? <label className="ps-field">Responsável<select value={ticket.assignedOperatorId ?? ""} disabled={updating} onChange={event => void changeTreatment({ assignedOperatorId: event.target.value || null })}><option value="">Sem atribuição</option>{operators.map(person => <option key={person.id} value={person.id}>{person.label}</option>)}</select></label> : <button type="button" className="ps-button" disabled={updating || ticket.assignedOperatorId === operatorId} onClick={() => void changeTreatment({ assignedOperatorId: operatorId })}>Assumir atendimento</button>}</div><form className="ps-note" onSubmit={event => void addNote(event)}><label className="ps-field">Nota interna<textarea value={noteDraft} onChange={event => { setNoteDraft(event.target.value); noteRequests.current.set(ticket.id, { content: event.target.value, id: crypto.randomUUID() }); }} maxLength={4000} disabled={updating} placeholder="Contexto visível somente à equipe." /></label><p className="ps-hint">Esta nota fica restrita à equipe Zyon.</p><button type="submit" className="ps-button" disabled={updating || !noteDraft.trim()}>Salvar nota interna</button></form>{notes.map(note => <article className="ps-note" key={note.id}><time dateTime={note.createdAt}>{dateTime(note.createdAt)}</time><p>{note.content}</p></article>)}</> : <p className="ps-hint">Selecione um chamado para ver a empresa, atribuir um responsável e registrar notas internas.</p>}</aside>}
    </div>
  </section>;
}

function ProtocolReference({ value }: { value: string }) {
  const [copyState, setCopyState] = useState<"idle" | "copied" | "error">("idle");
  const reset = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(reset.current), []);
  async function copy() {
    clearTimeout(reset.current);
    try { await navigator.clipboard.writeText(value); setCopyState("copied"); }
    catch { setCopyState("error"); }
    reset.current = setTimeout(() => setCopyState("idle"), 2500);
  }
  return <div className="ps-protocol">
    <span className="ps-protocol-label">Protocolo</span>
    <div className="ps-protocol-field">
      <code className="ps-protocol-code" title={value}>{value}</code>
      <button className="ps-protocol-copy" type="button" onClick={() => void copy()} aria-label="Copiar protocolo" title={copyState === "copied" ? "Protocolo copiado" : "Copiar protocolo"}>
        {copyState === "copied" ? <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="m5 12 4 4L19 6" /></svg> : <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><rect x="8" y="8" width="12" height="12" rx="2" /><path d="M16 8V4a1 1 0 0 0-1-1H4a1 1 0 0 0-1 1v11a1 1 0 0 0 1 1h4" /></svg>}
      </button>
    </div>
    <span className={copyState === "error" ? "ps-protocol-feedback" : "ps-screen-reader"} role="status">{copyState === "copied" ? "Protocolo copiado." : copyState === "error" ? "Selecione o código para copiar." : ""}</span>
  </div>;
}

function NewTicket({ client, allowed, onCancel, onCreated }: { client: PlatformSupportClient; allowed: boolean; onCancel(): void; onCreated(value: PlatformSupportConversation): void }) {
  const [subject, setSubject] = useState(""); const [category, setCategory] = useState<PlatformSupportCategory>("bug"); const [content, setContent] = useState(""); const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null);
  const request = useRef({ body: "", id: crypto.randomUUID() });
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    const body = JSON.stringify({ subject: subject.trim(), category, content: content.trim() });
    if (request.current.body !== body) request.current = { body, id: crypto.randomUUID() };
    setBusy(true); setError(null);
    try { onCreated(await client.create({ subject: subject.trim(), category, content: content.trim(), clientRequestId: request.current.id })); }
    catch (caught) { setError(platformSupportError(caught)); } finally { setBusy(false); }
  }
  return <form className="ps-new" onSubmit={event => void submit(event)}><button className="ps-button ps-back" type="button" onClick={onCancel}>← Voltar à fila</button><h3>Abrir chamado técnico</h3><p className="ps-hint">Conte o que aconteceu. A equipe responderá por aqui, e o histórico ficará salvo neste chamado.</p><label className="ps-field">Assunto<input value={subject} onChange={event => setSubject(event.target.value)} minLength={5} maxLength={160} required disabled={busy} placeholder="Ex.: erro ao publicar um produto" /></label><label className="ps-field">Categoria<select value={category} onChange={event => setCategory(event.target.value as PlatformSupportCategory)} disabled={busy}>{Object.entries(categories).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label className="ps-field">O que aconteceu?<textarea value={content} onChange={event => setContent(event.target.value)} minLength={10} maxLength={4000} required disabled={busy} rows={6} placeholder="Informe o que tentou fazer e o erro apresentado." /></label><p className="ps-hint">{content.length}/4000 · Evite senhas, dados de cartão e informações pessoais desnecessárias.</p>{!allowed && <p className="ps-hint">Abertura de chamados disponível para Growth e Escala. Se seu plano já está ativo, use Atualizar.</p>}{error && <div className="ps-alert" role="alert">{error}</div>}<div className="ps-actions"><button type="submit" className="ps-button ps-button--primary" disabled={busy || !allowed}>{busy ? "Abrindo…" : "Abrir chamado"}</button><button type="button" className="ps-button" disabled={busy} onClick={onCancel}>Cancelar</button></div></form>;
}
