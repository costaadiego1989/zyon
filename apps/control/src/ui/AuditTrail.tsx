import { type FormEvent, useEffect, useMemo, useState } from "react";
import { CircleAlert, FileClock, Filter, RefreshCw, Search, ShieldCheck } from "lucide-react";
import {
  PlatformApi,
  PlatformApiError,
  type PlatformAuditEvent,
  type PlatformAuditPage,
  type PlatformAuditQuery,
} from "../lib/api.js";

type AuditFilters = Pick<PlatformAuditQuery, "action" | "actor_operator_id" | "from" | "to">;

type AuditTrailProps = {
  api: PlatformApi;
  token: string;
  onSessionExpired: () => void;
};

export function AuditTrail({ api, token, onSessionExpired }: AuditTrailProps) {
  const [draftFilters, setDraftFilters] = useState<AuditFilters>({});
  const [filters, setFilters] = useState<AuditFilters>({});
  const [page, setPage] = useState<PlatformAuditPage | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filterError, setFilterError] = useState<string | null>(null);
  const [requestVersion, setRequestVersion] = useState(0);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    setPage(null);
    setSelectedId(null);

    void api.listAudit(token, { ...filters, limit: 50 })
      .then(response => {
        if (active) setPage(response);
      })
      .catch(caught => {
        if (!active) return;
        if (caught instanceof PlatformApiError && caught.status === 401) {
          onSessionExpired();
          return;
        }
        setError(auditErrorMessage(caught));
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => { active = false; };
  }, [api, filters, onSessionExpired, requestVersion, token]);

  const selected = useMemo(
    () => page?.items.find(item => item.id === selectedId) ?? null,
    [page?.items, selectedId],
  );

  function applyFilters(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalized = normalizeFilters(draftFilters);
    if (Boolean(normalized.from) !== Boolean(normalized.to)) {
      setFilterError("Informe as duas datas para filtrar por período.");
      return;
    }
    setFilterError(null);
    setFilters(normalized);
    setRequestVersion(value => value + 1);
  }

  function clearFilters() {
    setDraftFilters({});
    setFilters({});
    setFilterError(null);
    setRequestVersion(value => value + 1);
  }

  async function loadMore() {
    if (!page?.next_cursor || loadingMore) return;
    setLoadingMore(true);
    setError(null);

    try {
      const next = await api.listAudit(token, { ...filters, cursor: page.next_cursor, limit: 50 });
      setPage(current => {
        if (!current) return current;
        const knownIds = new Set(current.items.map(item => item.id));
        return {
          ...next,
          items: [...current.items, ...next.items.filter(item => !knownIds.has(item.id))],
        };
      });
    } catch (caught) {
      if (caught instanceof PlatformApiError && caught.status === 401) {
        onSessionExpired();
        return;
      }
      setError(auditErrorMessage(caught));
    } finally {
      setLoadingMore(false);
    }
  }

  return (
    <div className="page-flow audit-trail">
      <section className="page-intro page-intro--split" aria-labelledby="audit-title">
        <div>
          <p className="eyebrow">Registro operacional</p>
          <h2 id="audit-title">Trilha de auditoria</h2>
          <p>Eventos registrados por operadores da plataforma, com filtros de ação, autor e período.</p>
        </div>
        <button type="button" className="button button--secondary" onClick={() => setRequestVersion(value => value + 1)} disabled={loading}>
          <RefreshCw size={16} aria-hidden="true" />Atualizar
        </button>
      </section>

      <form className="audit-toolbar" aria-label="Filtros da trilha de auditoria" onSubmit={applyFilters}>
        <Filter size={17} aria-hidden="true" />
        <label className="field audit-toolbar__action">
          <span>Ação</span>
          <span className="audit-input">
            <Search size={15} aria-hidden="true" />
            <input
              type="search"
              value={draftFilters.action ?? ""}
              onChange={event => setDraftFilters(current => ({ ...current, action: event.target.value }))}
              placeholder="Ex.: platform.overview.read"
              autoComplete="off"
              maxLength={160}
              disabled={loading}
            />
          </span>
        </label>
        <label className="field">
          <span>ID do operador</span>
          <input
            type="search"
            value={draftFilters.actor_operator_id ?? ""}
            onChange={event => setDraftFilters(current => ({ ...current, actor_operator_id: event.target.value }))}
            placeholder="Opcional"
            autoComplete="off"
            maxLength={160}
            disabled={loading}
          />
        </label>
        <label className="field">
          <span>A partir de</span>
          <input
            type="datetime-local"
            value={toDateTimeInput(draftFilters.from)}
            onChange={event => setDraftFilters(current => ({ ...current, from: toUtcIso(event.target.value) }))}
            disabled={loading}
          />
        </label>
        <label className="field">
          <span>Até</span>
          <input
            type="datetime-local"
            value={toDateTimeInput(draftFilters.to)}
            onChange={event => setDraftFilters(current => ({ ...current, to: toUtcIso(event.target.value) }))}
            disabled={loading}
          />
        </label>
        <div className="audit-toolbar__actions">
          <button type="submit" className="button button--primary" disabled={loading}>Aplicar</button>
          <button type="button" className="button button--secondary" onClick={clearFilters} disabled={loading || !hasFilters(draftFilters)}>Limpar</button>
        </div>
        {filterError ? <p className="form-error audit-toolbar__error" role="alert">{filterError}</p> : null}
      </form>

      {loading && !page ? <AuditLoading /> : null}
      {error && !page ? <AuditFailure message={error} onRetry={() => setRequestVersion(value => value + 1)} /> : null}
      {page ? (
        <>
          <section className="audit-coverage" aria-label="Cobertura do registro de auditoria">
            <span className="coverage-icon"><ShieldCheck size={18} aria-hidden="true" /></span>
            <span>
              <strong>Eventos de auditoria</strong>
              <small>{page.coverage.audit_event_storage.description}</small>
            </span>
            <span className="source-state source-state--ready"><span aria-hidden="true" />Disponível</span>
          </section>

          {error ? <AuditFailure message={error} onRetry={() => setRequestVersion(value => value + 1)} /> : null}
          <section className="audit-layout" aria-label="Eventos de auditoria">
            <div className="audit-list-region">
              <div className="section-heading">
                <div>
                  <p className="eyebrow">Eventos retornados</p>
                  <h2>Atividades registradas</h2>
                </div>
                <span className="quiet-note">Lido em {formatDateTime(page.generated_at)}</span>
              </div>
              {page.items.length === 0 ? <AuditEmpty hasFilters={hasFilters(filters)} /> : (
                <div className="audit-table-wrap">
                  <table className="audit-table">
                    <caption className="visually-hidden">Eventos de auditoria retornados pela API da plataforma.</caption>
                    <thead>
                      <tr><th scope="col">Quando</th><th scope="col">Ação</th><th scope="col">Operador</th><th scope="col">Resultado</th><th scope="col">Alvo</th></tr>
                    </thead>
                    <tbody>
                      {page.items.map(item => (
                        <tr key={item.id} className={item.id === selectedId ? "audit-table__row--selected" : undefined}>
                          <td><time dateTime={item.occurred_at}>{formatDateTime(item.occurred_at)}</time></td>
                          <th scope="row"><button type="button" className="audit-event-button" onClick={() => setSelectedId(item.id)} aria-pressed={item.id === selectedId}>{item.action}</button></th>
                          <td>{formatActor(item)}</td>
                          <td><OutcomeBadge outcome={item.outcome} /></td>
                          <td>{formatTarget(item)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {page.next_cursor ? <button type="button" className="button button--secondary audit-load-more" onClick={() => void loadMore()} disabled={loadingMore}>{loadingMore ? "Carregando..." : "Carregar mais eventos"}</button> : null}
            </div>
            <AuditDetail event={selected} />
          </section>
        </>
      ) : null}
    </div>
  );
}

function AuditDetail({ event }: { event: PlatformAuditEvent | null }) {
  if (!event) {
    return <aside className="audit-detail audit-detail--empty" aria-label="Detalhe do evento"><FileClock size={23} aria-hidden="true" /><p>Selecione uma ação para consultar os dados registrados para aquele evento.</p></aside>;
  }

  const facts = [
    ["Evento", event.id],
    ["Quando", formatDateTime(event.occurred_at)],
    ["Resultado", event.outcome],
    ["Operador", formatActor(event)],
    ["Papel", event.actor_operator_role ?? "Não disponível"],
    ["Permissão", event.permission],
    ["Correlação", event.correlation_id],
    ["Ambiente", event.environment],
    ["Alvo", formatTarget(event)],
  ];
  const details = asDetailEntries(event.details);

  return (
    <aside className="audit-detail" aria-label={`Detalhe de ${event.action}`}>
      <p className="eyebrow">Detalhe do evento</p>
      <h3>{event.action}</h3>
      <dl className="audit-facts">
        {facts.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}
      </dl>
      {details.length > 0 ? (
        <section className="audit-details" aria-labelledby="audit-detail-fields">
          <h4 id="audit-detail-fields">Dados registrados</h4>
          <dl>{details.map(([key, value]) => <div key={key}><dt>{key}</dt><dd>{value}</dd></div>)}</dl>
        </section>
      ) : <p className="audit-details__empty">Este evento não possui dados adicionais registrados.</p>}
    </aside>
  );
}

function OutcomeBadge({ outcome }: { outcome: string }) {
  const normalized = outcome.trim().toLowerCase();
  const tone = normalized === "success" || normalized === "succeeded" ? "success" : normalized === "failed" || normalized === "failure" ? "failure" : "neutral";
  return <span className={`audit-outcome audit-outcome--${tone}`}>{outcome}</span>;
}

function AuditLoading() {
  return <section className="overview-snapshot" aria-busy="true" aria-live="polite"><div className="section-heading"><div><p className="eyebrow">Auditoria</p><h2>Carregando eventos registrados</h2></div></div><div className="feedback-skeleton" aria-hidden="true"><span className="feedback-skeleton__row" /><span className="feedback-skeleton__row" /><span className="feedback-skeleton__row" /></div></section>;
}

function AuditFailure({ message, onRetry }: { message: string; onRetry: () => void }) {
  return <section className="queue-error" role="alert"><CircleAlert size={19} aria-hidden="true" /><div><strong>Não foi possível carregar a auditoria</strong><p>{message}</p></div><button type="button" className="button button--secondary" onClick={onRetry}>Tentar novamente</button></section>;
}

function AuditEmpty({ hasFilters: filtered }: { hasFilters: boolean }) {
  return <div className="feedback-empty"><FileClock size={23} aria-hidden="true" /><h3>{filtered ? "Nenhum evento corresponde aos filtros" : "Nenhum evento de auditoria disponível"}</h3><p>{filtered ? "Ajuste os filtros para ampliar a consulta." : "Os novos eventos aparecerão aqui quando forem registrados pela plataforma."}</p></div>;
}

function normalizeFilters(filters: AuditFilters): AuditFilters {
  return {
    ...(filters.action?.trim() ? { action: filters.action.trim() } : {}),
    ...(filters.actor_operator_id?.trim() ? { actor_operator_id: filters.actor_operator_id.trim() } : {}),
    ...(filters.from ? { from: filters.from } : {}),
    ...(filters.to ? { to: filters.to } : {}),
  };
}

function hasFilters(filters: AuditFilters): boolean {
  return Boolean(filters.action?.trim() || filters.actor_operator_id?.trim() || filters.from || filters.to);
}

function toUtcIso(value: string): string | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function toDateTimeInput(value: string | undefined): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function formatDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Data não disponível";
  return new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(date);
}

function formatActor(event: PlatformAuditEvent): string {
  if (event.actor_operator_email) return event.actor_operator_email;
  if (event.actor_operator_id) return event.actor_operator_id;
  return "Não disponível";
}

function formatTarget(event: PlatformAuditEvent): string {
  if (event.target_type && event.target_id) return `${event.target_type}: ${event.target_id}`;
  return event.target_type ?? event.target_id ?? "Não disponível";
}

function asDetailEntries(value: unknown): Array<[string, string]> {
  if (!isRecord(value)) return [];
  return Object.entries(value).map(([key, field]) => [key, formatDetailValue(field)]);
}

function formatDetailValue(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return "Valor não serializável";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function auditErrorMessage(error: unknown): string {
  if (error instanceof PlatformApiError && error.status === 403) return "Seu papel não tem permissão para consultar a trilha de auditoria.";
  if (error instanceof PlatformApiError && error.status === 404) return "A fonte de auditoria ainda não está disponível neste ambiente.";
  if (error instanceof PlatformApiError && error.status >= 500) return "A fonte de auditoria não respondeu. Tente novamente em instantes.";
  return "Verifique a conexão com a API e tente novamente.";
}
