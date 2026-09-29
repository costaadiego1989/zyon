import React from "react";
import { Activity, ChevronRight, Download, ShieldCheck } from "lucide-react";
import type { MerchantProfile } from "../api-client.js";
import { PageHeader } from "../components/PageHeader.js";
import { Button } from "../components/Button.js";
import { DataPanel } from "../components/DataPanel.js";
import { EmptyState } from "../components/EmptyState.js";
import { FilterSelect, FilterToolbar } from "../components/FilterToolbar.js";
import { StatCard } from "./overview/components/StatCard.js";
import { useAuditLogPage, actionBadgeClass, formatAbsoluteTime, formatRelativeTime, type AuditFilters } from "./useAuditLogPage.js";
import "./administration-pages.css";

export function AuditLogPage(props: { apiBaseUrl: string; me: MerchantProfile | null }) {
  const vm = useAuditLogPage({ me: props.me });
  const filtered = Object.values(vm.filters).some(v => v !== "all");
  const clearFilters = () => vm.setFilters({ dateRange: "all", actionCategory: "all", actorType: "all" });
  if (!props.me) return <PageHeader title="Histórico de atividades" description="Entre na sua conta para consultar as atividades da loja." />;
  return <div className="administration-page">
    <PageHeader title="Histórico de atividades" description="Consulte quem realizou cada ação e quando ela aconteceu." actions={<Button variant="outline" disabled={vm.loading || !vm.totalFiltered} onClick={vm.exportCsv}><Download size={16} /> Exportar registros carregados</Button>} />
      {/* KPIs */}
      {!vm.loading && vm.events.length > 0 ? (
        <div className="grid-3" style={{ gap: 14, marginBottom: 20 }}>
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


    <FilterToolbar tabs={[]} activeTab="" onTabChange={() => {}} extra={<>
      <FilterSelect ariaLabel="Período" value={vm.filters.dateRange} onChange={v => vm.setFilters(f => ({ ...f, dateRange: v as AuditFilters["dateRange"] }))} options={[{value:"all",label:"Todo o período"},{value:"7d",label:"Últimos 7 dias"},{value:"30d",label:"Últimos 30 dias"},{value:"90d",label:"Últimos 90 dias"}]} />
      <FilterSelect ariaLabel="Tipo de ação" value={vm.filters.actionCategory} onChange={v => vm.setFilters(f => ({ ...f, actionCategory: v as AuditFilters["actionCategory"] }))} options={[{value:"all",label:"Todas as ações"},{value:"destructive",label:"Exclusões"},{value:"constructive",label:"Criações"},{value:"update",label:"Alterações"}]} />
      <FilterSelect ariaLabel="Autor da ação" value={vm.filters.actorType} onChange={v => vm.setFilters(f => ({ ...f, actorType: v as AuditFilters["actorType"] }))} options={[{value:"all",label:"Todos os autores"},{value:"human",label:"Pessoas"},{value:"service",label:"Sistema"}]} />
      {filtered && <Button variant="ghost" onClick={clearFilters}>Limpar filtros</Button>}
    </>} />
    <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">
      {vm.loading ? "Carregando atividades." : vm.loadingMore ? "Carregando registros anteriores." : vm.error ? "Não foi possível carregar as atividades." : vm.moreError ? "Não foi possível carregar mais registros. Os registros atuais foram mantidos." : `${vm.totalFiltered} atividades encontradas. Exibindo ${vm.pagedEvents.length} na página ${vm.page}.`}
    </p>
    {vm.loading ? <section className="panel admin-skeleton" aria-label="Carregando atividades" aria-busy="true">{[1,2,3,4].map(n => <div key={n} className="skeleton-cell" />)}</section> : vm.error ? <section className="panel"><EmptyState icon={ShieldCheck} title="Histórico indisponível" description="Não foi possível consultar as atividades. Tente novamente para acessar os registros." action={<Button variant="outline" onClick={() => void vm.load()}>Tentar novamente</Button>} /></section> : <>
      <DataPanel title="Atividades registradas" page={vm.page} pageSize={vm.pageSize} total={vm.totalFiltered} onPageChange={vm.setPage} isEmpty={!vm.pagedEvents.length} empty={{icon:ShieldCheck,title:filtered ? "Nenhuma atividade com estes filtros" : "Nenhuma atividade registrada",description:filtered ? "Altere os filtros ou carregue registros anteriores, se disponíveis." : "As ações realizadas na loja aparecerão aqui com data, autor e resultado.",action:filtered ? <Button variant="outline" onClick={clearFilters}>Limpar filtros</Button> : undefined}}>
        <div className="table-wrap"><table className="data-table"><caption className="sr-only">Atividades da loja</caption><thead><tr><th>Data</th><th>Tipo de autor</th><th>Ação</th><th>Recurso</th><th>Resultado</th><th>Autor</th><th><span className="sr-only">Detalhes</span></th></tr></thead><tbody>{vm.pagedEvents.map(evt => <React.Fragment key={evt.id}>
          <tr><td><time dateTime={evt.occurred_at} title={formatAbsoluteTime(evt.occurred_at)}>{formatRelativeTime(evt.occurred_at)}</time></td><td>{evt.actor_type === "human" ? "Pessoa" : "Sistema"}</td><td><span className={actionBadgeClass(evt.action)}>{evt.action}</span></td><td>{evt.resource_type}</td><td><span className={`badge ${evt.outcome === "failed" ? "bad" : "ok"}`}>{evt.outcome === "failed" ? "Falhou" : "Concluído"}</span></td><td>{evt.actor_id ?? "Sistema"}</td><td><Button className="admin-icon-action" variant="ghost" aria-label={`${vm.expandedRowId === evt.id ? "Recolher" : "Ver"} detalhes de ${evt.action}`} aria-expanded={vm.expandedRowId === evt.id} aria-controls={`detail-${evt.id}`} onClick={() => vm.toggleExpand(evt.id)}><ChevronRight size={18} style={{transform:vm.expandedRowId === evt.id ? "rotate(90deg)" : undefined}} /></Button></td></tr>
          {vm.expandedRowId === evt.id && <tr id={`detail-${evt.id}`}><td colSpan={7}><div className="admin-detail"><p><strong>Data e hora:</strong> {formatAbsoluteTime(evt.occurred_at)}</p>{evt.resource_id && <p><strong>Identificador do recurso:</strong> <code>{evt.resource_id}</code></p>}{evt.correlation_id && <p><strong>Identificador de rastreamento:</strong> <code>{evt.correlation_id}</code></p>}{evt.ip_address && <p><strong>Endereço IP:</strong> <code>{evt.ip_address}</code></p>}{evt.user_agent && <p><strong>Navegador ou aplicativo:</strong> <code>{evt.user_agent}</code></p>}<div><strong>Dados do evento</strong><pre>{evt.metadata ? JSON.stringify(evt.metadata,null,2) : "Nenhum dado adicional registrado."}</pre></div></div></td></tr>}
        </React.Fragment>)}</tbody></table></div>
      </DataPanel>
      <div className="admin-list-footer"><p className="admin-help">{vm.events.length} registros carregados. Os filtros e a exportação consideram esses registros.</p>{vm.hasMore && <Button variant="outline" onClick={() => void vm.loadMore()} loading={vm.loadingMore}>Carregar registros anteriores</Button>}</div>
      {vm.moreError && <p role="alert" className="admin-feedback admin-feedback--error">Não foi possível carregar mais registros. Os registros atuais foram mantidos. Tente novamente.</p>}
    </>}
  </div>;
}
