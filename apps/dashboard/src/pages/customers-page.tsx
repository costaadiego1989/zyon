import { PageHeader } from "../components/PageHeader.js";
import React, { useEffect, useMemo } from "react";
import { UsersRound, UserPlus, Repeat, Download, ArrowDown, ArrowUp, ShoppingBag } from "lucide-react";
import { DataPanel } from "../components/DataPanel.js";
import { StatCard } from "./overview/components/StatCard.js";
import { type MerchantProfile } from "../api-client.js";
import { type TenantCustomer } from "../api/types.js";
import { FilterToolbar } from "../components/FilterToolbar.js";
import { downloadCsv } from "../hooks/useCsvExport.js";
import { customerMetricPeriod, useCustomersPage } from "./useCustomersPage.js";
import { SectionErrorBoundary } from "../components/PageErrorBoundary.js";
import { maskPhone } from "../utils/masks.js";

export type CustomerRow = {
  globalUserId: string;
  name: string;
  email: string;
  phone: string;
  firstSeen: string;
  lastSeen: string;
  initials: string;
};

export interface CustomerPurchase {
  order_id: string;
  total_minor: number;
  completed_at: string;
}

export function calculatePurchaseMetrics(purchaseHistory: CustomerPurchase[] | null | undefined): {
  totalOrders: number;
  totalRevenue: number;
  avgTicket: number;
} {
  const totalOrders = purchaseHistory?.length ?? 0;
  const totalRevenue = purchaseHistory?.reduce(
    (sum, purchase) => sum + (Number.isFinite(purchase.total_minor) ? purchase.total_minor / 100 : 0),
    0,
  ) ?? 0;
  return {
    totalOrders,
    totalRevenue,
    avgTicket: totalOrders > 0 ? totalRevenue / totalOrders : 0,
  };
}

export function getInitials(name: string): string {
  if (!name || name === "-") return "?";
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0][0].toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function text(value: unknown): string {
  return typeof value === "string" && value ? value : "-";
}

export function toCustomerRows(customers: TenantCustomer[]): CustomerRow[] {
  return customers.map((customer) => {
    const rawName = typeof customer.profile.full_name === "string" && customer.profile.full_name ? customer.profile.full_name : "";
    const rawEmail = typeof customer.profile.email === "string" && customer.profile.email ? customer.profile.email : "";
    const rawPhone = typeof customer.profile.phone === "string" && customer.profile.phone ? customer.profile.phone : "";
    const name = rawName || "Cliente sem nome";
    return {
      globalUserId: customer.id,
      name,
      email: rawEmail || "Não informado",
      phone: rawPhone || "Não informado",
      firstSeen: customer.first_seen_at,
      lastSeen: customer.last_seen_at,
      initials: getInitials(rawName || name),
    };
  });
}

export function formatDate(value: string): string {
  if (!value) return "-";
  const date = new Date(value);
  if (isNaN(date.getTime())) return "-";
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(date);
}

export function filterRows(rows: CustomerRow[], term: string): CustomerRow[] {
  if (!term.trim()) return rows;
  const normalized = term.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  return rows.filter((row) => {
    const name = row.name.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
    const email = row.email.toLowerCase();
    const phone = row.phone.replace(/\D/g, "");
    const phoneTerm = term.replace(/\D/g, "");
    return name.includes(normalized) || email.includes(normalized) || (phoneTerm.length > 0 && phone.includes(phoneTerm));
  });
}

import { Button } from "../components/Button.js";
import { Modal } from "../components/Modal.js";
import { EmptyState } from "../components/EmptyState.js";
import { PageLoader } from "../components/PageLoader.js";
import "./customers-page.css";

export function CustomersPage(props: { apiBaseUrl: string; me: MerchantProfile | null }) {
  const vm = useCustomersPage(props);
  const filteredRows = useMemo(() => {
    let filtered = filterRows(vm.rows, vm.searchTerm);
    if (vm.dateFilter !== "all") {
      const period = customerMetricPeriod(vm.dateFilter);
      const from = new Date(period.dateFrom).getTime();
      const to = new Date(period.dateTo).getTime();
      filtered = filtered.filter((row) => {
        const activity = new Date(row.lastSeen).getTime();
        return activity >= from && activity <= to;
      });
    }
    return [...filtered].sort((a, b) => {
      const cmp = a[vm.sortCol].localeCompare(b[vm.sortCol], "pt-BR");
      return vm.sortDir === "asc" ? cmp : -cmp;
    });
  }, [vm.rows, vm.searchTerm, vm.dateFilter, vm.sortCol, vm.sortDir]);
  const metrics = vm.metrics;
  const repeatRate = metrics && Number.isFinite(metrics.repeatRate)
    ? (metrics.repeatRate * 100).toLocaleString("pt-BR", { maximumFractionDigits: 1 })
    : null;
  const periodLabel = vm.dateFilter === "all" ? "Todo o período" : `Últimos ${Number.parseInt(vm.dateFilter, 10)} dias`;
  const paginatedRows = filteredRows.slice((vm.page - 1) * vm.pageSize, vm.page * vm.pageSize);
  const hasFilters = Boolean(vm.searchTerm.trim() || vm.dateFilter !== "all");
  useEffect(() => { vm.setPage(Math.max(1, Math.min(vm.page, Math.ceil(filteredRows.length / vm.pageSize)))); }, [filteredRows.length, vm.page, vm.pageSize]);
  function clearFilters() { vm.setSearchTerm(""); vm.setDateFilter("all"); vm.setPage(1); }
  function exportCsv() {
    const cell = (value: string) => '"' + (/^[=+\-@]/.test(value.trimStart()) ? "'" : "") + value.replace(/"/g, '""') + '"';
    downloadCsv("Nome,E-mail,Telefone,Primeira visita,Última atividade", filteredRows.map(row => [row.name, row.email, row.phone, row.firstSeen, row.lastSeen].map(cell).join(",")), "clientes-" + new Date().toISOString().slice(0, 10) + ".csv");
  }
  if (!props.me) return <PageHeader title="Clientes" description="Entre na sua conta para consultar os clientes." />;
  return <div className="page-container customers-page">
    <PageHeader title="Clientes" description="Encontre um cliente e consulte seu histórico de compras." actions={<Button variant="outline" size="sm" disabled={vm.loading || filteredRows.length === 0} onClick={exportCsv}><Download size={14} /> Exportar CSV</Button>} />
      {/* KPI cards */}
      <div className="grid-3" style={{ gap: 14 }} aria-label={`Indicadores de clientes: ${periodLabel}`} aria-busy={vm.metricsLoading}>
        <StatCard
          label={vm.dateFilter === "all" ? "Total de compradores" : "Compradores no período"}
          value={metrics?.totalCustomers ?? "—"}
          icon={<UsersRound size={16} />}
          note={`${periodLabel} · Pedidos concluídos`}
        />
        <StatCard
          label="Novos compradores"
          value={metrics?.newCustomers ?? "—"}
          icon={<UserPlus size={16} />}
          accent="var(--color-success)"
          note="Primeira compra no período selecionado"
        />
        <StatCard
          label="Taxa de recompra"
          value={repeatRate ?? "—"}
          suffix={repeatRate === null ? undefined : "%"}
          icon={<Repeat size={16} />}
          accent="var(--color-brand)"
          note={metrics ? metrics.totalCustomers > 0 ? `${metrics.returningCustomers} de ${metrics.totalCustomers} compradores compraram novamente` : "Sem compras concluídas no período" : "Compradores que voltaram a comprar no período"}
        />
      </div>
      <p className="customers-period-help">A recompra considera compras anteriores de todo o histórico, mesmo de meses atrás. Cada comprador conta uma vez na taxa.</p>
      {vm.metricsError && <div className="panel-error operations-feedback" role="alert"><span>{vm.metricsError}</span><Button variant="outline" size="sm" disabled={vm.metricsLoading} onClick={vm.reloadMetrics}>Atualizar indicadores</Button></div>}
    <SectionErrorBoundary sectionName="Clientes">
      <FilterToolbar tabs={[{ key: "all", label: "Todo o período" }, { key: "7d", label: "Últimos 7 dias" }, { key: "30d", label: "Últimos 30 dias" }, { key: "90d", label: "Últimos 90 dias" }]} activeTab={vm.dateFilter} onTabChange={key => { vm.setDateFilter(key as typeof vm.dateFilter); vm.setPage(1); }} search={vm.searchTerm} onSearchChange={value => { vm.setSearchTerm(value); vm.setPage(1); }} searchPlaceholder="Buscar nome, e-mail ou telefone" />
      <p className="customers-period-help">O período vale para os indicadores e a última atividade da lista, em UTC. A busca filtra apenas a lista.</p>
      {vm.message && <div className="panel-error operations-feedback" role="alert"><span>{vm.message}</span><Button variant="outline" size="sm" disabled={vm.busy} onClick={() => void (vm.rows.length ? vm.loadMore() : vm.reload())}>Tentar novamente</Button></div>}
      {!vm.message || vm.rows.length ? <DataPanel title="Lista de clientes" page={vm.page} pageSize={vm.pageSize} total={vm.loading ? 0 : filteredRows.length} onPageChange={vm.setPage} isEmpty={!vm.loading && filteredRows.length === 0} empty={{ icon: UsersRound, title: hasFilters ? "Nenhum cliente com estes filtros" : "Sua lista de clientes começa aqui", description: hasFilters ? "Altere a busca ou o período da última atividade para encontrar o cliente." : "Os clientes aparecem após interagirem com o checkout da sua loja.", action: hasFilters ? <Button variant="outline" onClick={clearFilters}>Limpar filtros</Button> : undefined }}>
        {vm.loading ? <PageLoader /> : <div className="table-wrap"><table className="data-table"><caption className="sr-only">Clientes e última atividade na loja</caption><thead><tr>
          <th aria-label="Avatar" />
          {([{ label: "Nome", key: "name" }, { label: "E-mail", key: "email" }] as const).map(col => <th key={col.key} aria-sort={vm.sortCol === col.key ? vm.sortDir === "asc" ? "ascending" : "descending" : "none"}><button className="customers-sort" onClick={() => vm.toggleSort(col.key)}>{col.label}{vm.sortCol === col.key && (vm.sortDir === "asc" ? <ArrowUp size={14} /> : <ArrowDown size={14} />)}</button></th>)}
          <th>Telefone</th><th>Primeira visita</th><th aria-sort={vm.sortCol === "lastSeen" ? vm.sortDir === "asc" ? "ascending" : "descending" : "none"}><button className="customers-sort" onClick={() => vm.toggleSort("lastSeen")}>Última atividade{vm.sortCol === "lastSeen" && (vm.sortDir === "asc" ? <ArrowUp size={14} /> : <ArrowDown size={14} />)}</button></th>
        </tr></thead><tbody>{paginatedRows.map(row => <tr key={row.globalUserId} onClick={() => vm.openCustomerDetail(row.globalUserId)}>
          <td><span className="customer-avatar" aria-hidden="true">{row.initials}</span></td>
          <td><button className="customer-name" onClick={event => { event.stopPropagation(); vm.openCustomerDetail(row.globalUserId); }}>{row.name}</button></td>
          <td>{row.email}</td><td>{/\d/.test(row.phone) ? maskPhone(row.phone) : row.phone}</td><td>{formatDate(row.firstSeen)}</td><td>{formatDate(row.lastSeen)}</td>
        </tr>)}</tbody></table></div>}
      </DataPanel> : null}
      {vm.hasMore && <div className="customers-load-more"><p>A busca e a exportação incluem os {vm.rows.length} clientes carregados. Carregue mais registros para ampliar os resultados.</p><Button variant="outline" loading={vm.loadingMore} disabled={vm.busy} onClick={() => void vm.loadMore()}>Carregar mais clientes</Button></div>}
    </SectionErrorBoundary>
    {vm.selectedCustomerId && <CustomerDetailModal customer={vm.customerDetail} row={vm.rows.find(row => row.globalUserId === vm.selectedCustomerId) ?? null} loading={vm.loadingDetail} error={vm.detailError} onRetry={vm.retryDetail} onClose={vm.closeCustomerDetail} />}
  </div>;
}

function CustomerDetailModal({ customer, row, loading, error, onRetry, onClose }: { customer: unknown; row: CustomerRow | null; loading: boolean; error: string | null; onRetry: () => void; onClose: () => void }) {
  const detail = customer as Record<string, unknown> | null;
  const profile = detail?.profile as Record<string, unknown> | null;
  const history = Array.isArray(detail?.purchase_history) ? detail.purchase_history as CustomerPurchase[] : [];
  const { totalOrders, totalRevenue, avgTicket } = calculatePurchaseMetrics(history);
  const name = typeof profile?.full_name === "string" && profile.full_name ? profile.full_name : row?.name || "Cliente sem nome";
  const email = typeof profile?.email === "string" && profile.email ? profile.email : row?.email || "Não informado";
  const phone = typeof profile?.phone === "string" && profile.phone ? profile.phone : row?.phone || "Não informado";
  const money = (value: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value);
  return <Modal isOpen title={name} subtitle="Contato e histórico de compras na sua loja." presentation="center" size="lg" onClose={onClose} footer={<Button variant="outline" onClick={onClose}>Fechar</Button>}>
    <div className="customer-detail">
      {loading ? <PageLoader /> : error ? <EmptyState icon={UsersRound} title="Histórico indisponível" description={error} action={<Button variant="outline" onClick={onRetry}>Tentar novamente</Button>} /> : <>
        <dl className="customer-detail__facts"><div><dt>E-mail</dt><dd>{email}</dd></div><div><dt>Telefone</dt><dd>{/\d/.test(phone) ? maskPhone(phone) : phone}</dd></div>{row && <><div><dt>Primeira visita</dt><dd>{formatDate(row.firstSeen)}</dd></div><div><dt>Última atividade</dt><dd>{formatDate(row.lastSeen)}</dd></div></>}</dl>
        <dl className="customer-detail__totals"><div><dt>Pedidos</dt><dd>{totalOrders}</dd></div><div><dt>Receita</dt><dd>{money(totalRevenue)}</dd></div><div><dt>Ticket médio</dt><dd>{money(avgTicket)}</dd></div></dl>
        <section><h3>Histórico de compras</h3>{history.length ? <ul className="customer-detail__orders">{history.map((order, index) => <li key={order.order_id + index}><span>Pedido #{order.order_id.slice(-8)}</span><time>{formatDate(order.completed_at)}</time><strong>{money(order.total_minor / 100)}</strong></li>)}</ul> : <EmptyState icon={ShoppingBag} title="Nenhum pedido registrado" description="As compras deste cliente aparecerão aqui quando forem registradas na loja." />}</section>
      </>}
    </div>
  </Modal>;
}
