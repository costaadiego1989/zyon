import React, { useMemo } from "react";
import { UsersRound, UserPlus, Repeat, Download, X } from "lucide-react";
import { EmptyState } from "../components/EmptyState.js";
import { StatCard } from "./overview/components/StatCard.js";
import { type MerchantProfile } from "../api-client.js";
import { type TenantCustomer } from "../api/types.js";
import { Pagination } from "../components/Pagination.js";
import { FilterToolbar } from "../components/FilterToolbar.js";
import { downloadCsv } from "../hooks/useCsvExport.js";
import { useCustomersPage } from "./useCustomersPage.js";
import { SectionErrorBoundary } from "../components/PageErrorBoundary.js";

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
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
        <div>
          <span className="eyebrow">COMPRADORES</span>
          <h1 >Clientes</h1>
          <p className="page-lead">Visualize e gerencie os compradores que interagiram com seu checkout</p>
        </div>
        <button onClick={exportCsv} disabled={filteredRows.length === 0} style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 14px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--card)", font: "600 12.5px var(--sans)", color: "var(--ink)", cursor: "pointer", flex: "none" }}>
          <Download size={14} /> Exportar CSV
        </button>
      </div>

      {message ? <div style={{ padding: "12px 16px", borderRadius: 8, background: "var(--danger-soft)", border: "1px solid var(--danger)", font: "13px var(--sans)", color: "var(--danger)", marginBottom: 16 }}>{message}</div> : null}

      {/* KPI cards — matching overview StatCard pattern */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12, marginBottom: 20 }}>
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
          accent="var(--good)"
          trend={0}
        />
        <StatCard
          label="Taxa de Retorno"
          value={`${Math.round(metrics.returningRate * 100)}`}
          suffix="%"
          icon={<Repeat size={16} />}
          accent="var(--accent)"
          trend={0}
        />
      </div>

      {/* Customers table card */}
      <SectionErrorBoundary sectionName="Tabela de Clientes">
      <div style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 14, overflow: "hidden" }}>
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

        {loading ? (
          <div style={{ padding: "40px 22px", textAlign: "center", color: "var(--faint)", font: "13px var(--sans)" }}>Carregando clientes...</div>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead><tr>
              {["", "NOME", "E-MAIL", "TELEFONE", "PRIMEIRA VISITA", "ÚLTIMA VISITA"].map((c) => (
                <th key={c} style={{ textAlign: "left", padding: "10px 22px", font: "600 10.5px var(--mono)", letterSpacing: "0.05em", color: "var(--faint)", borderBottom: "1px solid var(--border)", cursor: c ? "pointer" : "default" }}>{c}</th>
              ))}
            </tr></thead>
            <tbody>
              {paginatedRows.map((row) => (
                <tr key={row.globalUserId} onClick={() => openCustomerDetail(row.globalUserId)} style={{ cursor: "pointer" }}>
                  <td style={{ padding: "12px 22px", borderBottom: "1px solid var(--border)" }}>
                    <div style={{ width: 28, height: 28, borderRadius: "50%", background: "var(--accent-soft)", color: "var(--accent-dark)", display: "flex", alignItems: "center", justifyContent: "center", font: "600 11px var(--sans)" }}>{row.initials}</div>
                  </td>
                  <td style={{ padding: "12px 22px", font: "13px var(--sans)", color: "var(--ink)", borderBottom: "1px solid var(--border)" }}>{row.name}</td>
                  <td style={{ padding: "12px 22px", font: "13px var(--mono)", color: "var(--muted)", borderBottom: "1px solid var(--border)" }}>{row.email}</td>
                  <td style={{ padding: "12px 22px", font: "13px var(--sans)", color: "var(--muted)", borderBottom: "1px solid var(--border)" }}>{row.phone}</td>
                  <td style={{ padding: "12px 22px", font: "13px var(--mono)", color: "var(--muted)", borderBottom: "1px solid var(--border)" }}>{formatDate(row.firstSeen)}</td>
                  <td style={{ padding: "12px 22px", font: "13px var(--mono)", color: "var(--muted)", borderBottom: "1px solid var(--border)" }}>{formatDate(row.lastSeen)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {filteredRows.length === 0 && !loading ? (
          <EmptyState icon={UsersRound} title="Nenhum comprador registrado ainda" description="Clientes aparecerão aqui após a primeira interação no checkout." />
        ) : null}

        {filteredRows.length > 0 ? (
          <Pagination page={page} pageSize={PAGE_SIZE} total={filteredRows.length} onChange={setPage} disabled={loading} />
        ) : null}
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
  const displayPhone = (row?.phone && row.phone !== "-") ? row.phone : "(00) 00000-0000";
  const displayInitials = (row?.initials && row.initials !== "?") ? row.initials : displayName.charAt(0).toUpperCase();

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 900, display: "flex", justifyContent: "flex-end" }} onClick={onClose}>
      <div style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.5)", backdropFilter: "blur(2px)" }} />
      <aside style={{ position: "relative", width: 480, maxWidth: "90vw", height: "100vh", overflowY: "auto", background: "var(--card)", borderLeft: "1px solid var(--border)", padding: "28px 24px", display: "flex", flexDirection: "column", gap: 20, animation: "slideInRight 0.2s ease-out" }} onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h2 style={{ font: "600 18px var(--serif)", color: "var(--accent)", margin: 0 }}>{displayName}</h2>
          <button type="button" onClick={onClose} aria-label="Fechar" style={{ width: 40, height: 40, borderRadius: 8, border: "1px solid var(--border)", background: "var(--card)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--ink)" }}>
            <X size={20} />
          </button>
        </div>

        {loading ? (
          <div style={{ textAlign: "center", padding: "40px 0", color: "var(--faint)", font: "13px var(--sans)" }}>Carregando...</div>
        ) : (
          <>
            {/* Contact info */}
            <div style={{ display: "flex", alignItems: "center", gap: 12, paddingBottom: 16, borderBottom: "1px solid var(--border)" }}>
              <div style={{ width: 48, height: 48, borderRadius: "50%", background: "var(--accent-soft)", color: "var(--accent)", display: "flex", alignItems: "center", justifyContent: "center", font: "700 16px var(--sans)", flexShrink: 0 }}>
                {displayInitials}
              </div>
              <div>
                <div style={{ font: "600 14px var(--sans)", color: "var(--ink)" }}>{displayName}</div>
                <div style={{ font: "12px var(--mono)", color: "var(--muted)", marginTop: 2 }}>{displayEmail}</div>
                <div style={{ font: "12px var(--sans)", color: "var(--muted)", marginTop: 2 }}>{displayPhone}</div>
              </div>
            </div>

            {/* Metrics */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
              <div style={{ background: "var(--bg)", borderRadius: 8, padding: "12px 14px" }}>
                <span className="eyebrow">PEDIDOS</span>
                <div style={{ font: "600 16px var(--mono)", color: "var(--ink)" }}>{totalOrders}</div>
              </div>
              <div style={{ background: "var(--bg)", borderRadius: 8, padding: "12px 14px" }}>
                <span className="eyebrow">RECEITA</span>
                <div style={{ font: "600 16px var(--mono)", color: "var(--accent)" }}>R$ {totalRevenue.toFixed(2)}</div>
              </div>
              <div style={{ background: "var(--bg)", borderRadius: 8, padding: "12px 14px" }}>
                <span className="eyebrow">TICKET MÉDIO</span>
                <div style={{ font: "600 16px var(--mono)", color: "var(--ink)" }}>R$ {avgTicket.toFixed(2)}</div>
              </div>
            </div>

            {/* Dates */}
            {row && (
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                <div style={{ background: "var(--bg)", borderRadius: 8, padding: "12px 14px" }}>
                  <span className="eyebrow">PRIMEIRA VISITA</span>
                  <div style={{ font: "13px var(--mono)", color: "var(--ink)" }}>{formatDate(row.firstSeen)}</div>
                </div>
                <div style={{ background: "var(--bg)", borderRadius: 8, padding: "12px 14px" }}>
                  <span className="eyebrow">ÚLTIMA ATIVIDADE</span>
                  <div style={{ font: "13px var(--mono)", color: "var(--ink)" }}>{formatDate(row.lastSeen)}</div>
                </div>
              </div>
            )}

            {/* Purchase history */}
            <div>
              <div style={{ font: "600 11px var(--mono)", color: "var(--faint)", letterSpacing: "0.05em", marginBottom: 10, textTransform: "uppercase" }}>Últimos pedidos</div>
              {purchaseHistory && purchaseHistory.length > 0 ? (
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {purchaseHistory.slice(0, 8).map((order, idx) => (
                    <div key={idx} style={{ padding: "10px 12px", background: "var(--bg)", borderRadius: 6, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <span style={{ font: "12px var(--mono)", color: "var(--ink)" }}>#{order.order_id.slice(-8)}</span>
                      <span style={{ font: "600 12px var(--mono)", color: "var(--accent)" }}>R$ {(order.total / 100).toFixed(2)}</span>
                      <span style={{ font: "11px var(--mono)", color: "var(--faint)" }}>{formatDate(order.completed_at)}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <p style={{ color: "var(--faint)", font: "13px var(--sans)", margin: 0, padding: "20px 0", textAlign: "center", background: "var(--bg)", borderRadius: 8 }}>Nenhum pedido registrado ainda</p>
              )}
            </div>
          </>
        )}
      </aside>
    </div>
  );
}
