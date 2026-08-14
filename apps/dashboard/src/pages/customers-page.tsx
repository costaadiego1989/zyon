import React, { useEffect, useState, useMemo } from "react";
import { RefreshCw, UsersRound, UserPlus, Repeat, Download, ArrowUpDown } from "lucide-react";
import {
  type CursorPage,
  type MerchantProfile,
  type TenantCustomer,
} from "../api-client.js";
import { Pagination } from "../components/Pagination.js";
import { useApi } from "../hooks/useApi.js";
import { downloadCsv } from "../hooks/useCsvExport.js";
import { DashboardHttpError } from "../api/http/index.js";

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
    const name = text(customer.profile.full_name);
    return {
      globalUserId: customer.id,
      name,
      email: text(customer.profile.email),
      phone: text(customer.profile.phone),
      firstSeen: customer.first_seen_at,
      lastSeen: customer.last_seen_at,
      initials: getInitials(name),
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

const PAGE_SIZE = 30;

export function CustomersPage(props: { apiBaseUrl: string; me: MerchantProfile | null }) {
  const api = useApi();
  const [rows, setRows] = useState<CustomerRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [sortCol, setSortCol] = useState<"name" | "email" | "lastSeen">("lastSeen");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [dateFilter, setDateFilter] = useState<"all" | "7d" | "30d">("all");
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 10;
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(null);
  const [customerDetail, setCustomerDetail] = useState<unknown | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);

  useEffect(() => {
    if (!props.me) {
      setRows([]);
      return;
    }
    void load();
  }, [props.me]); // eslint-disable-line react-hooks/exhaustive-deps

  async function load() {
    if (!props.me) return;
    setBusy(true);
    setLoading(true);
    setMessage(null);
    setRows([]);
    setNextCursor(null);
    setHasMore(false);
    try {
      const page: CursorPage<TenantCustomer> = await api.getCustomersPage(PAGE_SIZE);
      setRows(toCustomerRows(page.data));
      setNextCursor(page.next_cursor);
      setHasMore(page.has_more);
    } catch (e) {
      setMessage(
        e instanceof DashboardHttpError
          ? e.responseBody.slice(0, 160)
          : e instanceof Error
            ? e.message
            : String(e),
      );
    } finally {
      setBusy(false);
      setLoading(false);
    }
  }

  async function loadMore() {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    setBusy(true);
    try {
      const page: CursorPage<TenantCustomer> = await api.getCustomersPage(PAGE_SIZE, nextCursor);
      setRows((prev) => [...prev, ...toCustomerRows(page.data)]);
      setNextCursor(page.next_cursor);
      setHasMore(page.has_more);
    } catch (e) {
      setMessage(
        e instanceof DashboardHttpError
          ? e.responseBody.slice(0, 160)
          : e instanceof Error
            ? e.message
            : String(e),
      );
    } finally {
      setLoadingMore(false);
      setBusy(false);
    }
  }

  async function loadCustomerDetail(customerId: string) {
    setLoadingDetail(true);
    try {
      const detail = await api.getCustomerDetail(customerId);
      setCustomerDetail(detail);
    } catch (e) {
      setMessage(
        e instanceof DashboardHttpError
          ? e.responseBody.slice(0, 160)
          : e instanceof Error
            ? e.message
            : String(e),
      );
    } finally {
      setLoadingDetail(false);
    }
  }

  function openCustomerDetail(customerId: string) {
    setSelectedCustomerId(customerId);
    void loadCustomerDetail(customerId);
  }

  function closeCustomerDetail() {
    setSelectedCustomerId(null);
    setCustomerDetail(null);
  }

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
  }, [filteredRows, page]);

  const metrics = useMemo(() => computeMetrics(rows), [rows]);

  function toggleSort(col: typeof sortCol) {
    if (sortCol === col) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortCol(col);
      setSortDir("asc");
    }
  }

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
            <p className="page-lead">Login necessário.</p>
          </div>
        </header>
      </>
    );
  }

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
        <div>
          <div style={{ font: "600 10px var(--mono)", letterSpacing: "0.06em", color: "var(--faint)", marginBottom: 4 }}>COMPRADORES</div>
          <h1 style={{ font: "700 22px var(--serif)", color: "var(--ink)", letterSpacing: "-0.02em", marginBottom: 6 }}>Clientes</h1>
          <div style={{ font: "17px var(--serif)", fontStyle: "italic", color: "var(--muted)" }}>Visualize e gerencie os compradores que interagiram com seu checkout.</div>
        </div>
        <button onClick={exportCsv} disabled={filteredRows.length === 0} style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 14px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--card)", font: "600 12.5px var(--sans)", color: "var(--ink)", cursor: "pointer", flex: "none" }}>
          <Download size={14} /> Exportar CSV
        </button>
      </div>

      {message ? <div style={{ padding: "12px 16px", borderRadius: 8, background: "var(--danger-soft)", border: "1px solid var(--danger)", font: "13px var(--sans)", color: "var(--danger)", marginBottom: 16 }}>{message}</div> : null}

      {/* 4-col stat cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 16, marginBottom: 20 }}>
        {[
          { label: "TOTAL", value: metrics.total },
          { label: "NOVOS (7D)", value: metrics.newLast7Days },
          { label: "RETORNO", value: Math.round(metrics.returningRate * 100) + "%" },
        ].map((st) => (
          <div key={st.label} style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 14, padding: "18px 20px" }}>
            <div style={{ font: "600 10px var(--mono)", letterSpacing: "0.07em", color: "var(--faint)", marginBottom: 12 }}>{st.label}</div>
            <div style={{ font: "500 26px var(--serif)", color: "var(--ink)", letterSpacing: "-0.01em" }}>{st.value}</div>
          </div>
        ))}
      </div>

      {/* Customers table card */}
      <div style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 14, overflow: "hidden" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "16px 22px", borderBottom: "1px solid var(--border)" }}>
          <div style={{ display: "flex", gap: 8 }}>
            {(["all", "7d", "30d"] as const).map((value) => {
              const labels = { all: "Todos", "7d": "Últimos 7 dias", "30d": "Últimos 30 dias" };
              const active = dateFilter === value;
              return (
                <div key={value} onClick={() => { setDateFilter(value); setPage(1); }} style={{ padding: "7px 14px", borderRadius: 8, font: "600 12.5px var(--sans)", cursor: "pointer", background: active ? "var(--accent-dark)" : "var(--card)", color: active ? "white" : "var(--ink)", border: `1px solid ${active ? "var(--accent-dark)" : "var(--border)"}` }}>
                  {labels[value]}
                </div>
              );
            })}
          </div>
          <input
            placeholder="Buscar por nome, e-mail ou telefone..."
            value={searchTerm}
            onChange={(e) => { setSearchTerm(e.target.value); setPage(1); }}
            style={{ width: 280, padding: "8px 12px", borderRadius: 8, border: "1px solid var(--border)", font: "13px var(--sans)", color: "var(--ink)", outline: "none", background: "var(--bg)" }}
          />
        </div>

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
          <div style={{ padding: "40px 22px", textAlign: "center", display: "flex", flexDirection: "column", alignItems: "center", gap: 8, color: "var(--faint)" }}>
            <UsersRound size={32} />
            <strong style={{ font: "600 13px var(--sans)", color: "var(--ink)" }}>Nenhum comprador registrado ainda.</strong>
            <p style={{ font: "12.5px var(--sans)", color: "var(--faint)" }}>Clientes aparecerão aqui após a primeira interação no checkout.</p>
          </div>
        ) : null}

        {filteredRows.length > 0 ? (
          <Pagination page={page} pageSize={PAGE_SIZE} total={filteredRows.length} onChange={setPage} disabled={loading} />
        ) : null}
      </div>

      {selectedCustomerId ? (
        <CustomerDetailModal
          customer={customerDetail}
          loading={loadingDetail}
          onClose={closeCustomerDetail}
        />
      ) : null}
    </div>
  );
}

function CustomerDetailModal({
  customer,
  loading,
  onClose,
}: {
  customer: unknown;
  loading: boolean;
  onClose: () => void;
}) {
  const detail = customer as Record<string, unknown> | null;
  const profile = detail?.profile as Record<string, unknown> | null;
  const purchaseHistory = detail?.purchase_history as Array<{
    order_id: string;
    currency: string;
    total: number;
    discount: number;
    items: unknown;
    completed_at: string;
  }> | null;

  const totalOrders = purchaseHistory?.length ?? 0;
  const totalRevenue = purchaseHistory?.reduce((sum, p) => sum + (p.total / 100), 0) ?? 0;
  const avgTicket = totalOrders > 0 ? totalRevenue / totalOrders : 0;

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 900,
        display: "flex",
        justifyContent: "flex-end",
      }}
    >
      <div style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.5)", backdropFilter: "blur(2px)" }} />
      <aside
        onClick={(e) => e.stopPropagation()}
        style={{
          position: "relative",
          width: 480,
          maxWidth: "90vw",
          height: "100vh",
          overflowY: "auto",
          background: "var(--color-surface)",
          borderLeft: "1px solid var(--color-border)",
          padding: "28px 24px",
          display: "flex",
          flexDirection: "column",
          gap: 20,
          animation: "slideInRight 0.2s ease-out",
        }}
      >
        {loading ? (
          <div style={{ textAlign: "center", padding: "40px 0", color: "var(--faint)" }}>Carregando...</div>
        ) : detail ? (
          <>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 24 }}>
              <h2 style={{ font: "600 18px var(--serif)", color: "var(--ink)", margin: 0 }}>
                {typeof profile?.full_name === "string" ? profile.full_name : "Cliente"}
              </h2>
              <button
                onClick={onClose}
                style={{
                  background: "none",
                  border: "none",
                  fontSize: 20,
                  cursor: "pointer",
                  color: "var(--faint)",
                }}
              >
                ×
              </button>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 24 }}>
              {[
                { label: "E-MAIL", value: profile?.email || "-" },
                { label: "TELEFONE", value: profile?.phone || "-" },
                { label: "PEDIDOS", value: totalOrders },
                { label: "TICKET MÉDIO", value: `R$ ${avgTicket.toFixed(2)}` },
              ].map((stat) => (
                <div key={stat.label} style={{ background: "var(--bg)", borderRadius: 8, padding: "12px 14px" }}>
                  <div style={{ font: "600 10px var(--mono)", letterSpacing: "0.06em", color: "var(--faint)", marginBottom: 6 }}>
                    {stat.label}
                  </div>
                  <div style={{ font: "600 14px var(--sans)", color: "var(--ink)" }}>
                    {String(stat.value)}
                  </div>
                </div>
              ))}
            </div>

            <div style={{ marginBottom: 24 }}>
              <h3 style={{ font: "600 12px var(--mono)", color: "var(--faint)", letterSpacing: "0.05em", marginBottom: 12 }}>
                ÚLTIMOS PEDIDOS
              </h3>
              {purchaseHistory && purchaseHistory.length > 0 ? (
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {purchaseHistory.slice(0, 10).map((order, idx) => (
                    <div
                      key={idx}
                      style={{
                        padding: "10px 12px",
                        background: "var(--bg)",
                        borderRadius: 6,
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        font: "12px var(--mono)",
                      }}
                    >
                      <span style={{ color: "var(--ink)" }}>#{order.order_id}</span>
                      <span style={{ color: "var(--muted)" }}>
                        R$ {(order.total / 100).toFixed(2)}
                      </span>
                      <span style={{ color: "var(--faint)", fontSize: "11px" }}>
                        {formatDate(order.completed_at)}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <p style={{ color: "var(--faint)", font: "13px var(--sans)" }}>Nenhum pedido registrado</p>
              )}
            </div>

            <div style={{ marginBottom: 24 }}>
              <h3 style={{ font: "600 12px var(--mono)", color: "var(--faint)", letterSpacing: "0.05em", marginBottom: 12 }}>
                RECEITA TOTAL
              </h3>
              <div style={{ font: "600 22px var(--serif)", color: "var(--ink)" }}>
                R$ {totalRevenue.toFixed(2)}
              </div>
            </div>

            <button
              onClick={onClose}
              style={{
                width: "100%",
                padding: "10px 14px",
                borderRadius: 8,
                border: "1px solid var(--border)",
                background: "var(--bg)",
                font: "600 12.5px var(--sans)",
                color: "var(--ink)",
                cursor: "pointer",
              }}
            >
              Fechar
            </button>
          </>
        ) : (
          <div style={{ textAlign: "center", padding: "40px 0", color: "var(--faint)" }}>Erro ao carregar detalhes</div>
        )}
      </aside>
    </div>
  );
}
