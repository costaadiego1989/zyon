import React, { useMemo } from "react";
import { UsersRound, UserPlus, Repeat, Download, X } from "lucide-react";
import { DataPanel } from "../components/DataPanel.js";
import { StatCard } from "./overview/components/StatCard.js";
import { type MerchantProfile } from "../api-client.js";
import { type TenantCustomer } from "../api/types.js";
import { FilterToolbar } from "../components/FilterToolbar.js";
import { downloadCsv } from "../hooks/useCsvExport.js";
import { useCustomersPage } from "./useCustomersPage.js";
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

export interface CustomerMetrics {
  total: number;
  newLast7Days: number;
  returningRate: number;
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
      email: rawEmail || "email@exemplo.com",
      phone: rawPhone || "(00) 00000-0000",
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

export function computeMetrics(rows: CustomerRow[]): CustomerMetrics {
  const total = rows.length;
  const now = Date.now();
  const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1000;
  const newLast7Days = rows.filter((r) => {
    const d = new Date(r.firstSeen).getTime();
    return !isNaN(d) && d >= sevenDaysAgo;
  }).length;
  const returning = rows.filter((r) => r.firstSeen !== r.lastSeen).length;
  const returningRate = total > 0 ? returning / total : 0;
  return { total, newLast7Days, returningRate };
}

export function filterRows(rows: CustomerRow[], term: string): CustomerRow[] {
  if (!term.trim()) return rows;
  const normalized = term.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  return rows.filter((row) => {
    const name = row.name.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
    const email = row.email.toLowerCase();
    return name.includes(normalized) || email.includes(normalized);
  });
}

export function CustomersPage(props: { apiBaseUrl: string; me: MerchantProfile | null }) {
  const vm = useCustomersPage(props);
  const {
    rows, loading, message, searchTerm, sortCol, sortDir, dateFilter, page, pageSize: PAGE_SIZE,
    selectedCustomerId, customerDetail, loadingDetail,
    setSearchTerm, setDateFilter, setPage, openCustomerDetail, closeCustomerDetail,
  } = vm;

  const filteredRows = useMemo(() => {
    let filtered = filterRows(rows, searchTerm);
    if (dateFilter !== "all") {
      const days = dateFilter === "7d" ? 7 : 30;
      const cutoff = Date.now() - days * 86_400_000;
      filtered = filtered.filter((r) => new Date(r.lastSeen).getTime() >= cutoff);
    }
    return [...filtered].sort((a, b) => {
      const valA = a[sortCol] ?? "";
      const valB = b[sortCol] ?? "";
      const cmp = valA.localeCompare(valB);
      return sortDir === "asc" ? cmp : -cmp;
    });
  }, [rows, searchTerm, sortCol, sortDir, dateFilter]);

  const paginatedRows = useMemo(() => {
    const start = (page - 1) * PAGE_SIZE;
    return filteredRows.slice(start, start + PAGE_SIZE);
  }, [filteredRows, page, PAGE_SIZE]);

  const metrics = useMemo(() => computeMetrics(rows), [rows]);

  function exportCsv() {
    const header = "Nome,Email,Telefone,Primeira visita,Última atividade";
    const csvRows = filteredRows.map((r) =>
      [r.name, r.email, r.phone, r.firstSeen, r.lastSeen].join(",")
    );
    downloadCsv(header, csvRows, `clientes-${new Date().toISOString().slice(0, 10)}.csv`);
  }

  if (!props.me) {
    return (
      <>
        <header className="page-head">
          <div>
            <h1>Clientes</h1>
            <p className="page-lead">Login necessário</p>
          </div>
        </header>
      </>
    );
  }

  return (
    <div className="page-container">
      <header className="page-head">
        <div>
          <span className="eyebrow">Loja</span>
          <h1>Clientes</h1>
          <p className="page-lead">Visualize e gerencie os compradores que interagiram com seu checkout</p>
        </div>
        <button onClick={exportCsv} disabled={filteredRows.length === 0} className="zyn-btn zyn-btn--outline zyn-btn--sm" style={{ flex: "none" }}>
          <Download size={14} /> Exportar CSV
        </button>
      </header>

      {message ? <div className="panel-error">{message}</div> : null}

      {/* KPI cards */}
      <div className="grid-3" style={{ gap: 14 }}>
        <StatCard
          label="Total de Clientes"
          value={metrics.total}
          icon={<UsersRound size={16} />}
          trend={0}
        />
        <StatCard
          label="Novos (7 dias)"
          value={metrics.newLast7Days}
          icon={<UserPlus size={16} />}
          accent="var(--color-success)"
          trend={0}
        />
        <StatCard
          label="Taxa de Retorno"
          value={`${Math.round(metrics.returningRate * 100)}`}
          suffix="%"
          icon={<Repeat size={16} />}
          accent="var(--color-brand)"
          trend={0}
        />
      </div>

      {/* Customers table card */}
      <SectionErrorBoundary sectionName="Tabela de Clientes">
      <div style={{ background: "var(--surface-2)", border: "1px solid var(--color-border)", borderRadius: "var(--radius-md)", overflow: "hidden", boxShadow: "var(--card-shadow)" }}>
        <FilterToolbar
          tabs={[
            { key: "all", label: "Todos" },
            { key: "7d", label: "Últimos 7 dias" },
            { key: "30d", label: "Últimos 30 dias" },
          ]}
          activeTab={dateFilter}
          onTabChange={(k) => { setDateFilter(k as "all" | "7d" | "30d"); setPage(1); }}
          search={searchTerm}
          onSearchChange={(v) => { setSearchTerm(v); setPage(1); }}
          searchPlaceholder="Buscar por nome, e-mail ou telefone..."
          searchWidth={300}
        />

        <DataPanel
          title="Clientes"
          page={page}
          pageSize={PAGE_SIZE}
          total={filteredRows.length}
          onPageChange={setPage}
          isEmpty={filteredRows.length === 0 && !loading}
          empty={{ icon: UsersRound, title: "Nenhum comprador registrado ainda", description: "Clientes aparecerão aqui após a primeira interação no checkout." }}
        >
          {loading ? (
            <div style={{ padding: "40px 22px", textAlign: "center", color: "var(--color-text-faint)", font: "13px var(--font-sans)" }}>Carregando clientes...</div>
          ) : (
            <div className="table-wrap">
            <table className="data-table">
              <thead><tr>
                {["", "NOME", "E-MAIL", "TELEFONE", "PRIMEIRA VISITA", "ÚLTIMA VISITA"].map((c) => (
                  <th key={c} style={{ cursor: c ? "pointer" : "default" }}>{c}</th>
                ))}
              </tr></thead>
              <tbody>
                {paginatedRows.map((row) => (
                  <tr key={row.globalUserId} onClick={() => openCustomerDetail(row.globalUserId)} style={{ cursor: "pointer" }}>
                    <td>
                      <div style={{ width: 28, height: 28, borderRadius: "50%", background: "var(--color-brand-subtle)", color: "var(--color-brand)", display: "flex", alignItems: "center", justifyContent: "center", font: "600 11px var(--font-sans)" }}>{row.initials}</div>
                    </td>
                    <td style={{ font: "13px var(--font-sans)", color: "var(--color-text)" }}>{row.name}</td>
                    <td style={{ font: "13px var(--font-mono)", color: "var(--color-text-muted)" }}>{row.email}</td>
                    <td style={{ font: "13px var(--font-sans)", color: "var(--color-text-muted)" }}>{row.phone && row.phone !== "-" ? maskPhone(row.phone) : row.phone}</td>
                    <td style={{ font: "13px var(--font-mono)", color: "var(--color-text-muted)" }}>{formatDate(row.firstSeen)}</td>
                    <td style={{ font: "13px var(--font-mono)", color: "var(--color-text-muted)" }}>{formatDate(row.lastSeen)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          )}
        </DataPanel>
      </div>
      </SectionErrorBoundary>

      {selectedCustomerId ? (
        <CustomerDetailModal
          customer={customerDetail}
          row={rows.find((r) => r.globalUserId === selectedCustomerId) ?? null}
          loading={loadingDetail}
          onClose={closeCustomerDetail}
        />
      ) : null}
    </div>
  );
}

function CustomerDetailModal({
  customer,
  row,
  loading,
  onClose,
}: {
  customer: unknown;
  row: CustomerRow | null;
  loading: boolean;
  onClose: () => void;
}) {
  const detail = customer as Record<string, unknown> | null;
  const profile = detail?.profile as Record<string, unknown> | null;
  const purchaseHistory = detail?.purchase_history as Array<{
    order_id: string;
    total: number;
    completed_at: string;
  }> | null;

  const totalOrders = purchaseHistory?.length ?? 0;
  const totalRevenue = purchaseHistory?.reduce((sum, p) => sum + (p.total / 100), 0) ?? 0;
  const avgTicket = totalOrders > 0 ? totalRevenue / totalOrders : 0;

  const displayName = (profile?.full_name as string) || (row?.name && row.name !== "-" ? row.name : "Cliente sem nome");
  const displayEmail = (row?.email && row.email !== "-") ? row.email : (profile?.email as string) || "email@exemplo.com";
  const displayPhone = (row?.phone && row.phone !== "-") ? maskPhone(row.phone) : "(00) 00000-0000";
  const displayInitials = (row?.initials && row.initials !== "?") ? row.initials : displayName.charAt(0).toUpperCase();

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 900, display: "flex", justifyContent: "flex-end" }} onClick={onClose}>
      <div style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.6)", backdropFilter: "blur(4px)" }} />
      <aside style={{ position: "relative", width: 480, maxWidth: "90vw", height: "100vh", overflowY: "auto", background: "var(--surface-2)", borderLeft: "1px solid var(--color-border)", padding: "28px 24px", display: "flex", flexDirection: "column", gap: 20, animation: "slideInRight 0.2s ease-out", boxShadow: "0 20px 60px rgba(0,0,0,0.5)" }} onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h2 style={{ font: "600 18px var(--font-serif)", color: "var(--color-brand)", margin: 0 }}>{displayName}</h2>
          <button type="button" onClick={onClose} aria-label="Fechar" style={{ width: 40, height: 40, borderRadius: 8, border: "1px solid var(--color-border)", background: "transparent", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--color-text)" }}>
            <X size={20} />
          </button>
        </div>

        {loading ? (
          <div style={{ textAlign: "center", padding: "40px 0", color: "var(--color-text-faint)", font: "13px var(--font-sans)" }}>Carregando...</div>
        ) : (
          <>
            {/* Contact info */}
            <div style={{ display: "flex", alignItems: "center", gap: 12, paddingBottom: 16, borderBottom: "1px solid var(--color-border)" }}>
              <div style={{ width: 48, height: 48, borderRadius: "50%", background: "var(--color-brand-subtle)", color: "var(--color-brand)", display: "flex", alignItems: "center", justifyContent: "center", font: "700 16px var(--font-sans)", flexShrink: 0 }}>
                {displayInitials}
              </div>
              <div>
                <div style={{ font: "600 14px var(--font-sans)", color: "var(--color-text)" }}>{displayName}</div>
                <div style={{ font: "12px var(--font-mono)", color: "var(--color-text-muted)", marginTop: 2 }}>{displayEmail}</div>
                <div style={{ font: "12px var(--font-sans)", color: "var(--color-text-muted)", marginTop: 2 }}>{displayPhone}</div>
              </div>
            </div>

            {/* Metrics */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
              <div style={{ background: "var(--surface-1)", borderRadius: "var(--radius-sm)", padding: "12px 14px" }}>
                <span className="eyebrow">PEDIDOS</span>
                <div style={{ font: "600 16px var(--font-mono)", color: "var(--color-text)" }}>{totalOrders}</div>
              </div>
              <div style={{ background: "var(--surface-1)", borderRadius: "var(--radius-sm)", padding: "12px 14px" }}>
                <span className="eyebrow">RECEITA</span>
                <div style={{ font: "600 16px var(--font-mono)", color: "var(--color-brand)" }}>R$ {totalRevenue.toFixed(2)}</div>
              </div>
              <div style={{ background: "var(--surface-1)", borderRadius: "var(--radius-sm)", padding: "12px 14px" }}>
                <span className="eyebrow">TICKET MÉDIO</span>
                <div style={{ font: "600 16px var(--font-mono)", color: "var(--color-text)" }}>R$ {avgTicket.toFixed(2)}</div>
              </div>
            </div>

            {/* Dates */}
            {row && (
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                <div style={{ background: "var(--surface-1)", borderRadius: "var(--radius-sm)", padding: "12px 14px" }}>
                  <span className="eyebrow">PRIMEIRA VISITA</span>
                  <div style={{ font: "13px var(--font-mono)", color: "var(--color-text)" }}>{formatDate(row.firstSeen)}</div>
                </div>
                <div style={{ background: "var(--surface-1)", borderRadius: "var(--radius-sm)", padding: "12px 14px" }}>
                  <span className="eyebrow">ÚLTIMA ATIVIDADE</span>
                  <div style={{ font: "13px var(--font-mono)", color: "var(--color-text)" }}>{formatDate(row.lastSeen)}</div>
                </div>
              </div>
            )}

            {/* Purchase history */}
            <div>
              <div style={{ font: "600 11px var(--font-mono)", color: "var(--color-text-faint)", letterSpacing: "0.05em", marginBottom: 10, textTransform: "uppercase" }}>Últimos pedidos</div>
              {purchaseHistory && purchaseHistory.length > 0 ? (
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {purchaseHistory.slice(0, 8).map((order, idx) => (
                    <div key={idx} style={{ padding: "10px 12px", background: "var(--surface-1)", borderRadius: 6, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <span style={{ font: "12px var(--font-mono)", color: "var(--color-text)" }}>#{order.order_id.slice(-8)}</span>
                      <span style={{ font: "600 12px var(--font-mono)", color: "var(--color-brand)" }}>R$ {(order.total / 100).toFixed(2)}</span>
                      <span style={{ font: "11px var(--font-mono)", color: "var(--color-text-faint)" }}>{formatDate(order.completed_at)}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <p style={{ color: "var(--color-text-faint)", font: "13px var(--font-sans)", margin: 0, padding: "20px 0", textAlign: "center", background: "var(--surface-1)", borderRadius: "var(--radius-sm)" }}>Nenhum pedido registrado ainda</p>
              )}
            </div>
          </>
        )}
      </aside>
    </div>
  );
}
