import React, { useEffect, useMemo, useState } from "react";
import { RefreshCw, UsersRound, UserPlus, Repeat, Download, ArrowUpDown } from "lucide-react";
import {
  createDashboardApi,
  DashboardHttpError,
  type CursorPage,
  type MerchantProfile,
  type TenantCustomer,
} from "../api-client.js";

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
  const api = useMemo(() => createDashboardApi({ baseUrl: props.apiBaseUrl }), [props.apiBaseUrl]);
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

  const filteredRows = useMemo(() => {
    const filtered = filterRows(rows, searchTerm);
    return [...filtered].sort((a, b) => {
      const valA = a[sortCol] ?? "";
      const valB = b[sortCol] ?? "";
      const cmp = valA.localeCompare(valB);
      return sortDir === "asc" ? cmp : -cmp;
    });
  }, [rows, searchTerm, sortCol, sortDir]);
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
    const blob = new Blob([header + "\n" + csvRows.join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `clientes-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
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
    <>
      <header className="page-head">
        <div>
          <span className="eyebrow">Clientes</span>
          <h1>Clientes</h1>
          <p className="page-lead">Visualize e gerencie os compradores que interagiram com seu checkout.</p>
        </div>
        <div className="button-row">
          <button
            type="button"
            onClick={exportCsv}
            disabled={filteredRows.length === 0}
            aria-label="Exportar clientes em CSV"
          >
            <Download size={16} />
            Exportar lista
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void load()}
            aria-label="Atualizar lista de clientes"
          >
            <RefreshCw size={16} />
            Atualizar dados
          </button>
        </div>
      </header>

      {message ? <p className="panel panel-error">{message}</p> : null}

      <div className="metrics">
        <div className="metric">
          <span><UsersRound size={14} /> Total</span>
          <strong>{metrics.total}</strong>
        </div>
        <div className="metric">
          <span><UserPlus size={14} /> Novos (7d)</span>
          <strong>{metrics.newLast7Days}</strong>
        </div>
        <div className="metric">
          <span><Repeat size={14} /> Retorno</span>
          <strong>{Math.round(metrics.returningRate * 100)}%</strong>
        </div>
      </div>

      <section className="panel stacked">
        <div className="section-header">
          <h2>Clientes</h2>
          <UsersRound size={18} />
        </div>
        <div className="orders-toolbar">
          <input
            type="search"
            className="search-input"
            placeholder="Buscar por nome, e-mail ou telefone..."
            aria-label="Buscar por nome, e-mail ou telefone"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>

        {loading ? (
          <div className="empty-state" aria-hidden="true">
            <div className="skeleton" style={{ width: "100%", height: 200 }} />
          </div>
        ) : (
          <>
            <div className="table-wrap">
              <table
                className="data-table"
                aria-busy={loading || loadingMore}
                aria-label="Lista de clientes"
              >
                <thead>
                  <tr>
                    <th scope="col"></th>
                    <th scope="col" className="sortable" onClick={() => toggleSort("name")} aria-sort={sortCol === "name" ? sortDir === "asc" ? "ascending" : "descending" : undefined}>
                      Nome <ArrowUpDown size={12} />
                    </th>
                    <th scope="col" className="sortable" onClick={() => toggleSort("email")} aria-sort={sortCol === "email" ? sortDir === "asc" ? "ascending" : "descending" : undefined}>
                      E-mail <ArrowUpDown size={12} />
                    </th>
                    <th scope="col">Telefone</th>
                    <th scope="col">Primeira visita</th>
                    <th scope="col" className="sortable" onClick={() => toggleSort("lastSeen")} aria-sort={sortCol === "lastSeen" ? sortDir === "asc" ? "ascending" : "descending" : undefined}>
                      Última visita <ArrowUpDown size={12} />
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {filteredRows.map((row) => (
                    <tr key={row.globalUserId}>
                      <td>
                        <div className="customer-avatar">{row.initials}</div>
                      </td>
                      <td>{row.name}</td>
                      <td><code>{row.email}</code></td>
                      <td>{row.phone}</td>
                      <td>{formatDate(row.firstSeen)}</td>
                      <td>{formatDate(row.lastSeen)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {hasMore && !loading ? (
              <div className="load-more-row">
                <button
                  type="button"
                  disabled={loadingMore}
                  onClick={() => void loadMore()}
                  aria-label="Carregar mais clientes"
                >
                  Carregar mais
                </button>
              </div>
            ) : null}

            {filteredRows.length === 0 && !loading ? (
              <div className="empty-state" role="status">
                <div className="empty-state-icon">
                  <UsersRound size={32} />
                </div>
                <h3>Nenhum comprador registrado ainda.</h3>
                <p>Clientes aparecerão aqui após a primeira interação no checkout.</p>
              </div>
            ) : null}
          </>
        )}
      </section>
    </>
  );
}
