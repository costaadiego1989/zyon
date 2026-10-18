import { useEffect, useMemo, useState } from "react";
import {
  Check,
  ChevronRight,
  CircleAlert,
  FileClock,
  Filter,
  LoaderCircle,
  MessageSquareMore,
  RefreshCw,
  Send,
  UserRoundCheck,
} from "lucide-react";
import {
  PlatformApi,
  PlatformApiError,
  type FeedbackPriority,
  type FeedbackStatus,
  type PlatformFeedback,
  type PlatformOperator,
  type PlatformOperatorDirectoryEntry,
} from "../lib/api.js";

const statusLabels: Record<FeedbackStatus, string> = {
  new: "Novo",
  acknowledged: "Reconhecido",
  planned: "Planejado",
  in_progress: "Em andamento",
  resolved: "Resolvido",
  declined: "Recusado",
};

const priorityLabels: Record<FeedbackPriority, string> = {
  low: "Baixa",
  normal: "Normal",
  high: "Alta",
  critical: "Crítica",
};

const categoryLabels: Record<string, string> = {
  bug: "Bug",
  improvement: "Melhoria",
  suggestion: "Sugestão",
  other: "Outro",
};

export function FeedbackQueue({
  api,
  token,
  operator,
  onSessionExpired,
}: {
  api: PlatformApi;
  token: string;
  operator: PlatformOperator;
  onSessionExpired: () => void;
}) {
  const [status, setStatus] = useState<FeedbackStatus | "">("");
  const [category, setCategory] = useState("");
  const [items, setItems] = useState<PlatformFeedback[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedDetail, setSelectedDetail] = useState<PlatformFeedback | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    void api.listFeedback(token, {
      ...(status ? { status } : {}),
      ...(category ? { category } : {}),
    })
      .then(page => {
        if (cancelled) return;
        setItems(page.items);
        setNextCursor(page.nextCursor ?? null);
        setSelectedId(current => page.items.some(item => item.id === current) ? current : page.items[0]?.id ?? null);
      })
      .catch(caught => {
        if (cancelled) return;
        if (caught instanceof PlatformApiError && caught.status === 401) {
          onSessionExpired();
          return;
        }
        setError(feedbackErrorMessage(caught));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [api, category, onSessionExpired, refreshKey, status, token]);

  const selectedSummary = useMemo(() => items.find(item => item.id === selectedId) ?? null, [items, selectedId]);
  const editable = operator.role === "platform_admin" || operator.role === "support_ops";
  const canDelegate = operator.role === "platform_admin";
  const [operatorChoices, setOperatorChoices] = useState<PlatformOperatorDirectoryEntry[]>([]);
  const [operatorChoicesLoading, setOperatorChoicesLoading] = useState(false);
  const [operatorChoicesError, setOperatorChoicesError] = useState<string | null>(null);

  useEffect(() => {
    if (!canDelegate) {
      setOperatorChoices([]);
      setOperatorChoicesError(null);
      setOperatorChoicesLoading(false);
      return;
    }
    let cancelled = false;
    setOperatorChoicesLoading(true);
    setOperatorChoicesError(null);
    void (async () => {
      const choices: PlatformOperatorDirectoryEntry[] = [];
      let cursor: string | undefined;
      do {
        const page = await api.listOperators(token, { status: "active", limit: 100, ...(cursor ? { cursor } : {}) });
        choices.push(...page.items);
        cursor = page.next_cursor ?? undefined;
      } while (cursor);
      if (!cancelled) setOperatorChoices(choices);
    })().catch(caught => {
      if (cancelled) return;
      if (caught instanceof PlatformApiError && caught.status === 401) {
        onSessionExpired();
        return;
      }
      setOperatorChoicesError("Não foi possível carregar operadores ativos para atribuição.");
    }).finally(() => {
      if (!cancelled) setOperatorChoicesLoading(false);
    });
    return () => { cancelled = true; };
  }, [api, canDelegate, onSessionExpired, token]);

  useEffect(() => {
    if (!selectedSummary) {
      setSelectedDetail(null);
      setDetailError(null);
      setDetailLoading(false);
      return;
    }
    let cancelled = false;
    setSelectedDetail(selectedSummary);
    setDetailError(null);
    setDetailLoading(true);
    void api.getFeedback(token, selectedSummary.id)
      .then(detail => {
        if (!cancelled) setSelectedDetail(detail);
      })
      .catch(caught => {
        if (cancelled) return;
        if (caught instanceof PlatformApiError && caught.status === 401) {
          onSessionExpired();
          return;
        }
        setDetailError(feedbackErrorMessage(caught));
      })
      .finally(() => {
        if (!cancelled) setDetailLoading(false);
      });
    return () => { cancelled = true; };
  }, [api, onSessionExpired, selectedSummary, token]);

  function replaceItem(updated: PlatformFeedback) {
    setItems(current => current.map(item => item.id === updated.id ? updated : item));
    setSelectedDetail(updated);
    setSelectedId(updated.id);
  }

  async function loadMore() {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    setError(null);
    try {
      const page = await api.listFeedback(token, {
        ...(status ? { status } : {}),
        ...(category ? { category } : {}),
        cursor: nextCursor,
      });
      setItems(current => {
        const known = new Set(current.map(item => item.id));
        return [...current, ...page.items.filter(item => !known.has(item.id))];
      });
      setNextCursor(page.nextCursor ?? null);
    } catch (caught) {
      if (caught instanceof PlatformApiError && caught.status === 401) {
        onSessionExpired();
        return;
      }
      setError(feedbackErrorMessage(caught));
    } finally {
      setLoadingMore(false);
    }
  }

  return (
    <div className="page-flow feedback-page">
      <section className="page-intro page-intro--split">
        <div>
          <h2>Fila de feedback</h2>
          <p>Sugestões e problemas enviados pelas empresas. Notas e tratamento são internos.</p>
        </div>
        <button type="button" className="button button--secondary" onClick={() => setRefreshKey(value => value + 1)} disabled={loading}>
          <RefreshCw size={16} aria-hidden="true" />Atualizar
        </button>
      </section>

      <section className="feedback-toolbar" aria-label="Filtros da fila">
        <Filter size={17} aria-hidden="true" />
        <label>
          <span>Status</span>
          <select value={status} onChange={event => setStatus(event.target.value as FeedbackStatus | "")} disabled={loading}>
            <option value="">Todos os estados</option>
            {Object.entries(statusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>
        <label>
          <span>Categoria</span>
          <select value={category} onChange={event => setCategory(event.target.value)} disabled={loading}>
            <option value="">Todas as categorias</option>
            {Object.entries(categoryLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>
      </section>

      {error ? <QueueError message={error} onRetry={() => setRefreshKey(value => value + 1)} /> : null}
      {!error ? (
        <section className="feedback-layout" aria-label="Feedback recebido">
          <div className="feedback-list-region">
            {loading ? <FeedbackSkeleton /> : null}
            {!loading && items.length === 0 ? <EmptyFeedback /> : null}
            {!loading && items.length > 0 ? (
              <div className="feedback-list" role="list">
                {items.map(item => (
                  <button
                    type="button"
                    role="listitem"
                    key={item.id}
                    className={`feedback-row ${item.id === selectedId ? "feedback-row--selected" : ""}`}
                    onClick={() => setSelectedId(item.id)}
                    aria-pressed={item.id === selectedId}
                  >
                    <span className="feedback-row__metadata">
                      <time dateTime={item.createdAt}>{formatDate(item.createdAt)}</time>
                      <span>{item.merchantName ?? "Merchant não identificado"}</span>
                    </span>
                    <span className="feedback-row__message">{item.message}</span>
                    <span className="feedback-row__state"><StatusPill status={item.treatment.status} /><ChevronRight size={17} aria-hidden="true" /></span>
                  </button>
                ))}
              </div>
            ) : null}
            {!loading && items.length > 0 && nextCursor ? <button type="button" className="button button--secondary feedback-load-more" onClick={() => void loadMore()} disabled={loadingMore}>{loadingMore ? "Carregando..." : "Carregar mais feedbacks"}</button> : null}
          </div>
          <FeedbackDetail
            api={api}
            token={token}
            feedback={selectedDetail}
            editable={editable}
            operator={operator}
            canDelegate={canDelegate}
            operatorChoices={operatorChoices}
            operatorChoicesLoading={operatorChoicesLoading}
            operatorChoicesError={operatorChoicesError}
            historyLoading={detailLoading}
            historyError={detailError}
            onUpdate={replaceItem}
            onSessionExpired={onSessionExpired}
          />
        </section>
      ) : null}
    </div>
  );
}

function FeedbackDetail({
  api,
  token,
  feedback,
  editable,
  operator,
  canDelegate,
  operatorChoices,
  operatorChoicesLoading,
  operatorChoicesError,
  historyLoading,
  historyError,
  onUpdate,
  onSessionExpired,
}: {
  api: PlatformApi;
  token: string;
  feedback: PlatformFeedback | null;
  editable: boolean;
  operator: PlatformOperator;
  canDelegate: boolean;
  operatorChoices: PlatformOperatorDirectoryEntry[];
  operatorChoicesLoading: boolean;
  operatorChoicesError: string | null;
  historyLoading: boolean;
  historyError: string | null;
  onUpdate: (feedback: PlatformFeedback) => void;
  onSessionExpired: () => void;
}) {
  const [status, setStatus] = useState<FeedbackStatus>("new");
  const [priority, setPriority] = useState<FeedbackPriority>("normal");
  const [assignedOperatorId, setAssignedOperatorId] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!feedback) return;
    setStatus(feedback.treatment.status);
    setPriority(feedback.treatment.priority);
    setAssignedOperatorId(feedback.treatment.assignedOperatorId ?? null);
    setNote("");
    setMessage(null);
  }, [feedback]);

  if (!feedback) {
    return <aside className="feedback-detail feedback-detail--empty" aria-label="Detalhe do feedback"><MessageSquareMore size={24} aria-hidden="true" /><p>Selecione um feedback para ver a mensagem e seu tratamento.</p></aside>;
  }

  const originalAssignee = feedback.treatment.assignedOperatorId ?? null;
  const assignmentChanged = assignedOperatorId !== originalAssignee;
  const statusChanged = status !== feedback.treatment.status;
  const priorityChanged = priority !== feedback.treatment.priority;
  const noteChanged = Boolean(note.trim());
  const hasChanges = statusChanged || priorityChanged || assignmentChanged || noteChanged;
  const feedbackId = feedback.id;

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editable || !hasChanges) return;
    setSaving(true);
    setMessage(null);
    try {
      const updated = await api.updateFeedbackTreatment(token, feedbackId, {
        ...(statusChanged ? { status } : {}),
        ...(priorityChanged ? { priority } : {}),
        ...(assignmentChanged ? { assignedOperatorId } : {}),
        ...(noteChanged ? { note } : {}),
      });
      onUpdate(updated);
      setNote("");
      setMessage("Tratamento atualizado.");
    } catch (caught) {
      if (caught instanceof PlatformApiError && caught.status === 401) {
        onSessionExpired();
        return;
      }
      setMessage(feedbackErrorMessage(caught));
    } finally {
      setSaving(false);
    }
  }

  const existingAssignee = feedback.treatment.assignedOperatorId;
  const existingAssigneeLabel = feedback.treatment.assignedOperatorEmail
    ?? (existingAssignee === operator.operator_id ? operator.email + " (você)" : "Operador interno");
  const assignmentOptions = new Map<string, string>();
  if (canDelegate) {
    for (const choice of operatorChoices) assignmentOptions.set(choice.operator_id, choice.email);
  }
  if (existingAssignee) assignmentOptions.set(existingAssignee, existingAssigneeLabel);
  assignmentOptions.set(operator.operator_id, operator.email + " (eu)");
  const timeline = treatmentTimeline(feedback);

  return (
    <aside className="feedback-detail" aria-labelledby="feedback-detail-title">
      <div className="detail-heading">
        <div>
          <p className="eyebrow">{categoryLabels[feedback.category] ?? feedback.category}</p>
          <h3 id="feedback-detail-title">{feedback.merchantName ?? "Empresa não identificada"}</h3>
        </div>
        <StatusPill status={feedback.treatment.status} />
      </div>
      <p className="feedback-message">{feedback.message}</p>
      <dl className="feedback-facts">
        <div><dt>Recebido</dt><dd><time dateTime={feedback.createdAt}>{formatDateTime(feedback.createdAt)}</time></dd></div>
        <div><dt>Enviado por</dt><dd>{feedback.authorEmail ?? "Não disponível"}</dd></div>
        <div><dt>Prioridade</dt><dd>{priorityLabels[feedback.treatment.priority]}</dd></div>
        <div><dt>Responsável</dt><dd>{existingAssignee ? existingAssigneeLabel : "Sem atribuição"}</dd></div>
      </dl>

      <section className="feedback-history" aria-labelledby="feedback-history-title" aria-busy={historyLoading}>
        <div className="feedback-history__heading">
          <div>
            <p className="eyebrow">Registro interno</p>
            <h4 id="feedback-history-title">Histórico de tratamento</h4>
          </div>
          {historyLoading ? <LoaderCircle className="feedback-history__loader" size={16} aria-label="Atualizando histórico" /> : <FileClock size={17} aria-hidden="true" />}
        </div>
        {historyError ? <p className="feedback-history__error" role="status">{historyError} O tratamento atual permanece disponível.</p> : null}
        {!historyLoading && timeline.length === 0 ? <p className="feedback-history__empty">Nenhuma nota ou alteração registrada até agora.</p> : null}
        {timeline.length > 0 ? <ol className="feedback-timeline">{timeline.map(entry => (
          <li key={`${entry.kind}-${entry.id}`} className={`feedback-timeline__entry feedback-timeline__entry--${entry.kind}`}>
            <time dateTime={entry.at}>{formatDateTime(entry.at)}</time>
            <div>
              <strong>{entry.actor}</strong>
              <p>{entry.copy}</p>
            </div>
          </li>
        ))}</ol> : null}
      </section>

      <form className="treatment-form" onSubmit={submit} aria-busy={saving}>
        <div className="treatment-form__heading"><h4>Tratamento interno</h4>{!editable ? <span className="quiet-note">Somente leitura</span> : null}</div>
        <div className="form-grid">
          <label className="field"><span>Status</span><select value={status} onChange={event => setStatus(event.target.value as FeedbackStatus)} disabled={!editable || saving}>{Object.entries(statusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          <label className="field"><span>Prioridade</span><select value={priority} onChange={event => setPriority(event.target.value as FeedbackPriority)} disabled={!editable || saving}>{Object.entries(priorityLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        </div>
        <label className="field">
          <span>Responsável</span>
          <select value={assignedOperatorId ?? ""} onChange={event => setAssignedOperatorId(event.target.value || null)} disabled={!editable || saving || operatorChoicesLoading}>
            <option value="">Sem atribuição</option>
            {[...assignmentOptions.entries()].map(([operatorId, label]) => <option key={operatorId} value={operatorId}>{label}</option>)}
          </select>
        </label>
        <p className="form-hint"><UserRoundCheck size={15} aria-hidden="true" />{canDelegate
          ? operatorChoicesLoading ? "Carregando operadores ativos para atribuição." : operatorChoicesError ?? "Você pode atribuir este feedback a qualquer operador ativo ou remover a atribuição."
          : "Você pode assumir este feedback ou remover a atribuição. A transferência para outro operador exige um administrador."}</p>
        <label className="field"><span>Nota interna</span><textarea value={note} onChange={event => setNote(event.target.value)} maxLength={4000} placeholder="Registre o contexto da decisão" disabled={!editable || saving} /></label>
        {message ? <p className={message === "Tratamento atualizado." ? "form-success" : "form-error"} role="status">{message === "Tratamento atualizado." ? <Check size={15} aria-hidden="true" /> : null}{message}</p> : null}
        {editable ? <button className="button button--primary button--wide" type="submit" disabled={saving || !hasChanges}><Send size={16} aria-hidden="true" />{saving ? "Salvando..." : "Salvar tratamento"}</button> : null}
      </form>
    </aside>
  );
}

type TimelineEntry = {
  id: string;
  kind: "note" | "audit";
  at: string;
  actor: string;
  copy: string;
};

function treatmentTimeline(feedback: PlatformFeedback): TimelineEntry[] {
  const notes = feedback.treatment.notes ?? (feedback.treatment.latestNote ? [feedback.treatment.latestNote] : []);
  const noteEntries: TimelineEntry[] = notes.map(note => ({
    id: note.id,
    kind: "note",
    at: note.createdAt,
    actor: note.operatorEmail ?? "Operador interno",
    copy: note.message,
  }));
  const auditEntries: TimelineEntry[] = (feedback.treatment.auditHistory ?? []).map(event => ({
    id: event.id,
    kind: "audit",
    at: event.occurredAt,
    actor: event.actorOperatorEmail ?? "Operador interno",
    copy: treatmentChangeCopy(event),
  }));
  return [...noteEntries, ...auditEntries].sort((left, right) => right.at.localeCompare(left.at));
}

function treatmentChangeCopy(event: NonNullable<PlatformFeedback["treatment"]["auditHistory"]>[number]): string {
  const changes: string[] = [];
  if (event.current.status && event.current.status !== event.previous.status) {
    const previous = event.previous.status ? `${statusLabels[event.previous.status]} para ` : "";
    changes.push(`Status alterado de ${previous}${statusLabels[event.current.status]}.`);
  }
  if (event.current.priority && event.current.priority !== event.previous.priority) {
    const previous = event.previous.priority ? `${priorityLabels[event.previous.priority]} para ` : "";
    changes.push(`Prioridade alterada de ${previous}${priorityLabels[event.current.priority]}.`);
  }
  if ("assignedOperatorId" in event.current && event.current.assignedOperatorId !== event.previous.assignedOperatorId) {
    changes.push(event.current.assignedOperatorId ? "Responsável atribuído." : "Atribuição removida.");
  }
  if (event.noteAdded) changes.push("Nota interna adicionada.");
  return changes.join(" ") || "Tratamento atualizado.";
}

function StatusPill({ status }: { status: FeedbackStatus }) {
  return <span className={`status-pill status-pill--${status}`}><span aria-hidden="true" />{statusLabels[status]}</span>;
}

function FeedbackSkeleton() {
  return <div className="feedback-skeleton" aria-label="Carregando fila" aria-busy="true">{Array.from({ length: 6 }, (_, index) => <span key={index} className="feedback-skeleton__row" />)}</div>;
}

function EmptyFeedback() {
  return <div className="feedback-empty"><MessageSquareMore size={25} aria-hidden="true" /><h3>Nenhum feedback encontrado</h3><p>Ajuste os filtros ou aguarde novos envios das empresas.</p></div>;
}

function QueueError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return <div className="queue-error" role="alert"><CircleAlert size={20} aria-hidden="true" /><div><strong>Não foi possível carregar a fila</strong><p>{message}</p></div><button type="button" className="button button--secondary" onClick={onRetry}>Tentar novamente</button></div>;
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "short" }).format(new Date(value));
}

function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

function feedbackErrorMessage(error: unknown): string {
  if (error instanceof PlatformApiError && error.status === 403) return "Seu papel não tem permissão para acessar esta fila.";
  if (error instanceof PlatformApiError && error.status === 404) return "Este feedback não está mais disponível.";
  if (error instanceof PlatformApiError && error.status >= 500) return "A fonte de feedback não respondeu. Tente novamente em instantes.";
  return "Verifique a conexão com a API e tente novamente.";
}
