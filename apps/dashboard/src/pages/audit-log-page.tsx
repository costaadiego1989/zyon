import React from "react";
import { Activity, ChevronRight, Download, RefreshCw, ShieldCheck } from "lucide-react";
import type { MerchantProfile } from "../api-client.js";
import { Button } from "../components/Button.js";
import { StatCard } from "./overview/components/StatCard.js";
import { SectionHeader } from "../components/SectionHeader.js";
import { Pagination } from "../components/Pagination.js";
import { EmptyState } from "../components/EmptyState.js";
import {
  useAuditLogPage,
  type AuditFilters,
  actionBadgeClass,
  formatRelativeTime,
  formatAbsoluteTime,
} from "./useAuditLogPage.js";

export function AuditLogPage(props: { apiBaseUrl: string; me: MerchantProfile | null }) {
  const vm = useAuditLogPage({ me: props.me });

  if (!props.me) {
    return (
      <header className="page-head">
        <div>
          <h1>Auditoria</h1>
          <p className="page-lead">Login necessário para acompanhar as ações do painel.</p>
        </div>
      </header>
    );
  }

  return (
    <>
      <header className="page-head">
        <div>
          <span className="eyebrow"><ShieldCheck size={14} aria-hidden="true" style={{ marginRight: 6, verticalAlign: "middle" }} />Conta</span>
          <h1>Log de Auditoria</h1>
          <p className="page-lead">Acompanhe todas as ações realizadas no painel.</p>
        </div>
        <div className="button-row" style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
          <Button variant="primary" size="sm" arrow onClick={vm.exportCsv} aria-label="Exportar registros">
            <Download size={14} /> Exportar
          </Button>
        </div>
      </header>

      {vm.error && !vm.loading ? <p className="panel panel-warn">{vm.error}</p> : null}

      {/* KPIs */}
      {!vm.loading && vm.events.length > 0 ? (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 14, marginBottom: 20 }}>
          <StatCard
            label="Total de eventos"
            value={vm.events.length}
            icon={<ShieldCheck size={16} />}
          />
          <StatCard
            label="Filtrados"
            value={vm.totalFiltered}
            icon={<Activity size={16} />}
          />
          <StatCard
            label="Exibidos"
            value={vm.pagedEvents.length}
            icon={<ChevronRight size={16} />}
          />
        </div>
      ) : null}

      <section className="panel stacked">
        <SectionHeader icon={<ShieldCheck size={18} />} title="Eventos recentes" variant="secondary" />

        {/* Filters */}
        <div className="audit-filter-bar" style={{ display: "flex", gap: "var(--space-3)", alignItems: "center", marginBottom: "var(--space-4)", flexWrap: "wrap" }}>
          <select
            value={vm.filters.dateRange}
            onChange={e => vm.setFilters(f => ({ ...f, dateRange: e.target.value as AuditFilters["dateRange"] }))}
            style={{ flex: 1, minWidth: 120 }}
          >
            <option value="all">Período</option>
            <option value="7d">7 dias</option>
            <option value="30d">30 dias</option>
            <option value="90d">90 dias</option>
          </select>
          <select
            value={vm.filters.actionCategory}
            onChange={e => vm.setFilters(f => ({ ...f, actionCategory: e.target.value as AuditFilters["actionCategory"] }))}
            style={{ flex: 1, minWidth: 120 }}
          >
            <option value="all">Tipo de ação</option>
            <option value="destructive">Exclusão</option>
            <option value="constructive">Criação</option>
            <option value="update">Alteração</option>
          </select>
          <select
            value={vm.filters.actorType}
            onChange={e => vm.setFilters(f => ({ ...f, actorType: e.target.value as AuditFilters["actorType"] }))}
            style={{ flex: 1, minWidth: 120 }}
          >
            <option value="all">Autor</option>
            <option value="human">Pessoa</option>
            <option value="service">Sistema</option>
          </select>
          <span className="audit-summary" style={{ marginLeft: "auto", whiteSpace: "nowrap" }}>
            Exibindo {vm.pagedEvents.length} de {vm.totalFiltered} eventos
          </span>
        </div>

        {/* Table content */}
        <div aria-live="polite" aria-busy={vm.loading}>
          {vm.loading ? (
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Data</th>
                    <th>Tipo</th>
                    <th>Ação</th>
                    <th>Recurso</th>
                    <th>Resultado</th>
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
                      <td><div className="skeleton-cell" style={{ width: 60 }} /></td>
                      <td><div className="skeleton-cell" style={{ width: 70 }} /></td>
                      <td><div className="skeleton-cell" style={{ width: 20 }} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <>
              {vm.pagedEvents.length > 0 ? (
                <div className="table-wrap">
                  <table className="data-table">
                    <caption className="sr-only">Log de auditoria do merchant</caption>
                    <thead>
                      <tr>
                        <th>Data</th>
                        <th>Tipo</th>
                        <th>Ação</th>
                        <th>Recurso</th>
                        <th>Resultado</th>
                        <th>Ator</th>
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {vm.pagedEvents.map((evt, idx) => (
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
                            <td>
                              <span>{evt.resource_type}</span>
                              {evt.resource_id ? (
                                <code style={{ display: "block", fontSize: 10, color: "var(--color-muted)", marginTop: 2 }}>{evt.resource_id}</code>
                              ) : null}
                            </td>
                            <td>
                              <span className={evt.outcome === "failed" ? "badge bad" : "badge ok"} style={{ fontSize: 10, padding: "2px 6px" }}>
                                {evt.outcome === "failed" ? "Falhou" : "OK"}
                              </span>
                            </td>
                            <td>
                              <code>{evt.actor_id ?? "sistema"}</code>
                            </td>
                            <td>
                              <button
                                type="button"
                                onClick={() => vm.toggleExpand(evt.id)}
                                aria-expanded={vm.expandedRowId === evt.id}
                                aria-controls={`detail-${evt.id}`}
                                aria-label="Expandir detalhes do evento"
                                style={{ background: "none", border: "none", cursor: "pointer", padding: 4 }}
                              >
                                <ChevronRight
                                  size={14}
                                  style={{
                                    transform: vm.expandedRowId === evt.id ? "rotate(90deg)" : "none",
                                    transition: "transform 0.15s",
                                  }}
                                />
                              </button>
                            </td>
                          </tr>
                          {vm.expandedRowId === evt.id ? (
                            <tr className="audit-detail-row" id={`detail-${evt.id}`}>
                              <td colSpan={7}>
                                <div style={{ display: "flex", flexDirection: "column", gap: 8, padding: "8px 0" }}>
                                  {evt.correlation_id ? (
                                    <p style={{ margin: 0, fontSize: 12 }}>
                                      <strong>ID Correlação:</strong> <code>{evt.correlation_id}</code>
                                    </p>
                                  ) : null}
                                  {evt.ip_address ? (
                                    <p style={{ margin: 0, fontSize: 12 }}>
                                      <strong>IP:</strong> <code>{evt.ip_address}</code>
                                    </p>
                                  ) : null}
                                  {evt.user_agent ? (
                                    <p style={{ margin: 0, fontSize: 12 }}>
                                      <strong>User-Agent:</strong> <code style={{ wordBreak: "break-all" }}>{evt.user_agent}</code>
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
                <EmptyState
                  icon={ShieldCheck}
                  title="Nenhuma atividade registrada"
                  description="Nenhuma atividade registrada no período selecionado."
                />
              )}

              {vm.totalFiltered > vm.pageSize ? (
                <Pagination
                  page={vm.page}
                  pageSize={vm.pageSize}
                  total={vm.totalFiltered}
                  onChange={vm.setPage}
                  disabled={vm.loadingMore}
                />
              ) : null}
            </>
          )}
        </div>
      </section>
    </>
  );
}
