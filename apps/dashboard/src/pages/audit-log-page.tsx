import React, { useEffect, useState } from "react";
import { ChevronRight, Download, RefreshCw, ShieldCheck } from "lucide-react";
import {
  type AuditEvent,
  type MerchantProfile,
} from "../api-client.js";
import { useApi } from "../hooks/useApi.js";
import { readError } from "../utils/read-error.js";
import { downloadCsv } from "../hooks/useCsvExport.js";

// ── Types ────────────────────────────────────────────────────────────────────

interface AuditFilters {
  dateRange: "7d" | "30d" | "90d" | "all";
  actionCategory: "destructive" | "constructive" | "update" | "all";
  actorType: "human" | "service" | "all";
}

// ── Pure functions (exported for testability) ────────────────────────────────

export function actionBadgeCategory(action: string): "destructive" | "constructive" | "update" | "other" {
  if (/delete|remove|revoke|disable/i.test(action)) return "destructive";
  if (/create|add|enable|approve/i.test(action)) return "constructive";
  if (/update|edit|change|modify/i.test(action)) return "update";
  return "other";
}

function actionBadgeClass(action: string): string {
  const cat = actionBadgeCategory(action);
  switch (cat) {
    case "destructive": return "badge bad";
    case "constructive": return "badge ok";
    case "update": return "badge warn";
    default: return "badge muted";
  }
}

export function filterEvents(events: AuditEvent[], filters: AuditFilters): AuditEvent[] {
  return events.filter(evt => {
    if (filters.dateRange !== "all") {
      const days = { "7d": 7, "30d": 30, "90d": 90 }[filters.dateRange];
      const cutoff = Date.now() - days * 86_400_000;
      if (new Date(evt.occurred_at).getTime() < cutoff) return false;
    }
    if (filters.actionCategory !== "all") {
      if (actionBadgeCategory(evt.action) !== filters.actionCategory) return false;
    }
    if (filters.actorType !== "all" && evt.actor_type !== filters.actorType) return false;
    return true;
  });
}

function formatRelativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return "agora";
  if (minutes < 60) return `há ${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `há ${hours}h`;
  const days = Math.floor(hours / 24);
  return `há ${days}d`;
}

function formatAbsoluteTime(iso: string): string {
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(
    new Date(iso),
  );
}

function exportCsv(events: AuditEvent[]): void {
  const header = "Data,Tipo Ator,Ator,Ação,Recurso,ID Recurso,ID Correlação";
  const rows = events.map(e =>
    [e.occurred_at, e.actor_type, e.actor_id ?? "", e.action,
     e.resource_type, e.resource_id ?? "", e.correlation_id ?? ""].join(",")
  );
  downloadCsv(header, rows, `auditoria-${new Date().toISOString().slice(0, 10)}.csv`);
}

// ── Component ────────────────────────────────────────────────────────────────

export function AuditLogPage(props: { apiBaseUrl: string; me: MerchantProfile | null }) {
  const api = useApi();
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState<AuditFilters>({
    dateRange: "all",
    actionCategory: "all",
    actorType: "all",
  });
  const [expandedRowId, setExpandedRowId] = useState<string | null>(null);

  const filteredEvents = useMemo(() => filterEvents(events, filters), [events, filters]);

  useEffect(() => {
    if (!props.me) {
      setEvents([]);
      return;
    }
    void load();
  }, [props.me]); // eslint-disable-line react-hooks/exhaustive-deps

  async function load() {
    setLoading(true);
    setError(null);
    setEvents([]);
    setNextCursor(null);
    setHasMore(false);
    try {
      const page = await api.getAuditEvents({ limit: 50 });
      const items = Array.isArray(page?.data) ? page.data : Array.isArray(page) ? page as unknown as AuditEvent[] : [];
      setEvents(items);
      setNextCursor(page?.next_cursor ?? null);
      setHasMore(page?.has_more ?? false);
    } catch (e) {
      setError(readError(e));
    } finally {
      setLoading(false);
    }
  }

  async function loadMore() {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const page = await api.getAuditEvents({ limit: 50, cursor: nextCursor });
      const items = Array.isArray(page?.data) ? page.data : Array.isArray(page) ? page as unknown as AuditEvent[] : [];
      setEvents(prev => [...prev, ...items]);
      setNextCursor(page?.next_cursor ?? null);
      setHasMore(page?.has_more ?? false);
    } catch (e) {
      setError(readError(e));
    } finally {
      setLoadingMore(false);
    }
  }

  if (!props.me) {
    return (
      <>
        <header className="page-head">
          <div>
            <h1>Auditoria</h1>
            <p className="page-lead">Login necessário para acompanhar as ações do painel.</p>
          </div>
        </header>
      </>
    );
  }

  return (
    <>
      <header className="page-head">
        <div>
          <span className="eyebrow"><ShieldCheck size={14} aria-hidden="true" style={{ marginRight: 6, verticalAlign: "middle" }} />Conta</span>
          <h1>Log de Auditoria</h1>
          <p className="page-lead">
            Acompanhe todas as ações realizadas no painel.
          </p>
        </div>
        <div className="button-row" style={{ marginLeft: "auto" }}>
          <button
            type="button"
            disabled={loading}
            onClick={() => void load()}
            aria-label="Atualizar log de auditoria"
          >
            <RefreshCw size={16} />
            Atualizar
          </button>
          <button
            type="button"
            className="primary-action"
            onClick={() => exportCsv(filteredEvents)}
            aria-label="Exportar registros"
          >
            <Download size={16} />
            Exportar
          </button>
        </div>
      </header>

      {error && !loading ? <p className="panel panel-warn">{error}</p> : null}

      <section className="panel stacked">
        <div className="panel-title">
          <h2>Eventos recentes</h2>
          <ShieldCheck size={18} />
        </div>

        <div className="audit-filter-bar" style={{ display: "flex", gap: "var(--space-3)", alignItems: "center", marginBottom: "var(--space-4)", flexWrap: "wrap" }}>
          <select
            value={filters.dateRange}
            onChange={e => setFilters(f => ({ ...f, dateRange: e.target.value as AuditFilters["dateRange"] }))}
            style={{ flex: 1, minWidth: 120 }}
          >
            <option value="all">Período</option>
            <option value="7d">7 dias</option>
            <option value="30d">30 dias</option>
            <option value="90d">90 dias</option>
          </select>
          <select
            value={filters.actionCategory}
            onChange={e => setFilters(f => ({ ...f, actionCategory: e.target.value as AuditFilters["actionCategory"] }))}
            style={{ flex: 1, minWidth: 120 }}
          >
            <option value="all">Tipo de ação</option>
            <option value="destructive">Exclusão</option>
            <option value="constructive">Criação</option>
            <option value="update">Alteração</option>
          </select>
          <select
            value={filters.actorType}
            onChange={e => setFilters(f => ({ ...f, actorType: e.target.value as AuditFilters["actorType"] }))}
            style={{ flex: 1, minWidth: 120 }}
          >
            <option value="all">Autor</option>
            <option value="human">Pessoa</option>
            <option value="service">Sistema</option>
          </select>
          <span className="audit-summary" style={{ marginLeft: "auto", whiteSpace: "nowrap" }}>
            Exibindo {filteredEvents.length} de {events.length} eventos
          </span>
        </div>

        <div aria-live="polite" aria-busy={loading}>
          {loading ? (
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Data</th>
                    <th>Tipo</th>
                    <th>Ação</th>
                    <th>Recurso</th>
                    <th>Ator</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {Array.from({ length: 5 }).map((_, i) => (
                    <tr key={i} className="skeleton-row">
                      <td><div className="skeleton-cell" style={{ width: 80 }} /></td>
                      <td><div className="skeleton-cell" style={{ width: 50 }} /></td>
                      <td><div className="skeleton-cell" style={{ width: 100 }} /></td>
                      <td><div className="skeleton-cell" style={{ width: 90 }} /></td>
                      <td><div className="skeleton-cell" style={{ width: 70 }} /></td>
                      <td><div className="skeleton-cell" style={{ width: 20 }} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <>
              {filteredEvents.length > 0 ? (
                <div className="table-wrap">
                  <table className="data-table">
                    <caption className="sr-only">Log de auditoria do merchant</caption>
                    <thead>
                      <tr>
                        <th>Data</th>
                        <th>Tipo</th>
                        <th>Ação</th>
                        <th>Recurso</th>
                        <th>Ator</th>
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredEvents.map((evt, idx) => (
                        <React.Fragment key={evt.id}>
                          <tr style={{ background: idx % 2 === 0 ? "var(--color-surface-raised)" : undefined, borderBottom: "1px solid var(--color-border)" }}>
                            <td>
                              <time dateTime={evt.occurred_at} title={formatAbsoluteTime(evt.occurred_at)}>
                                {formatRelativeTime(evt.occurred_at)}
                              </time>
                            </td>
                            <td>
                              <span className={`actor-badge ${evt.actor_type}`}>
                                {evt.actor_type === "human" ? "Pessoa" : "Sistema"}
                              </span>
                            </td>
                            <td>
                              <span className={actionBadgeClass(evt.action)} style={{ display: "inline-block", fontSize: 11, padding: "2px 8px", whiteSpace: "nowrap", minWidth: 72, textAlign: "center" }}>
                                <code>{evt.action}</code>
                              </span>
                            </td>
                            <td>{evt.resource_type}</td>
                            <td>
                              <code>{evt.actor_id ?? "sistema"}</code>
                            </td>
                            <td>
                              <button
                                type="button"
                                onClick={() => setExpandedRowId(prev => prev === evt.id ? null : evt.id)}
                                aria-expanded={expandedRowId === evt.id}
                                aria-controls={`detail-${evt.id}`}
                                aria-label="Expandir detalhes do evento"
                                style={{ background: "none", border: "none", cursor: "pointer", padding: 4 }}
                              >
                                <ChevronRight
                                  size={14}
                                  style={{
                                    transform: expandedRowId === evt.id ? "rotate(90deg)" : "none",
                                    transition: "transform 0.15s",
                                  }}
                                />
                              </button>
                            </td>
                          </tr>
                          {expandedRowId === evt.id ? (
                            <tr className="audit-detail-row" id={`detail-${evt.id}`}>
                              <td colSpan={6}>
                                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                                  {evt.correlation_id ? (
                                    <p style={{ margin: 0, fontSize: 12 }}>
                                      <strong>ID Correlação:</strong> <code>{evt.correlation_id}</code>
                                    </p>
                                  ) : null}
                                  <div>
                                    <strong style={{ fontSize: 12 }}>Metadados:</strong>
                                    <pre>{evt.metadata ? JSON.stringify(evt.metadata, null, 2) : "—"}</pre>
                                  </div>
                                </div>
                              </td>
                            </tr>
                          ) : null}
                        </React.Fragment>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="empty-state" style={{ textAlign: "center", padding: "48px 16px", display: "flex", flexDirection: "column", alignItems: "center", gap: 12 }}>
                  <div className="empty-state-icon" style={{ background: "var(--color-surface-alt, rgba(0,0,0,0.04))", borderRadius: "50%", width: 64, height: 64, display: "flex", alignItems: "center", justifyContent: "center" }}>
                    <ShieldCheck size={32} style={{ color: "var(--color-muted)" }} />
                  </div>
                  <h3 style={{ margin: 0 }}>Nenhuma atividade registrada</h3>
                  <p style={{ margin: 0, color: "var(--color-muted)" }}>
                    Nenhuma atividade registrada no período selecionado.
                  </p>
                </div>
              )}

              {hasMore ? (
                <div className="load-more-row">
                  <button
                    type="button"
                    disabled={loadingMore}
                    onClick={() => void loadMore()}
                  >
                    {loadingMore ? "Carregando..." : "Carregar mais"}
                  </button>
                </div>
              ) : null}
            </>
          )}
        </div>
      </section>
    </>
  );
}
