import React, { useEffect, useMemo, useState } from "react";
import {
  Activity,
  Download,
  Package,
  PackageSearch,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Truck,
} from "lucide-react";
import {
  createDashboardApi,
  DashboardHttpError,
  type CursorPage,
  type MerchantProfile,
  type TenantOrder,
} from "../api-client.js";

// ── Constants ────────────────────────────────────────────────────────────────

const PAGE_SIZE = 50;

export const STATUS_LABELS: Record<string, string> = {
  approved: "Aprovado",
  cancelled: "Cancelado",
  pending: "Pendente",
  processing: "Processando",
  failed: "Falhou",
  refunded: "Reembolsado",
};

// ── Types ────────────────────────────────────────────────────────────────────

export type OrderMetrics = {
  totalOrders: number;
  approvedCount: number;
  approvalRate: number;
  totalRevenue: number;
  trackedCount: number;
  averageOrderValue: number;
};

// ── Pure utility functions ───────────────────────────────────────────────────

export function computeOrderMetrics(orders: TenantOrder[]): OrderMetrics {
  if (orders.length === 0) {
    return {
      totalOrders: 0,
      approvedCount: 0,
      approvalRate: 0,
      totalRevenue: 0,
      trackedCount: 0,
      averageOrderValue: 0,
    };
  }

  const approved = orders.filter((o) => o.status === "approved");
  const totalRevenue = approved.reduce((sum, o) => sum + o.total, 0);
  const trackedCount = orders.filter((o) => o.tracking_code !== null).length;

  return {
    totalOrders: orders.length,
    approvedCount: approved.length,
    approvalRate: approved.length / orders.length,
    totalRevenue,
    trackedCount,
    averageOrderValue: approved.length > 0 ? totalRevenue / approved.length : 0,
  };
}

export function filterOrders(
  orders: TenantOrder[],
  status: string,
  query: string,
): TenantOrder[] {
  let filtered = orders;

  if (status !== "all") {
    filtered = filtered.filter((o) => o.status === status);
  }

  if (query.trim()) {
    const q = query.trim().toLowerCase();
    filtered = filtered.filter((o) => {
      if (o.external_order_id.toLowerCase().includes(q)) return true;
      const label = customerLabel(o.customer);
      if (label !== "-" && label.toLowerCase().includes(q)) return true;
      return false;
    });
  }

  return filtered;
}

// ── Existing utilities (unchanged) ───────────────────────────────────────────

function orderBadgeClass(status: string): string {
  if (status === "approved") return "badge ok";
  if (status === "cancelled" || status === "failed" || status === "refunded") return "badge bad";
  if (status === "pending" || status === "processing") return "badge warn";
  return "badge muted";
}

function customerLabel(customer: Record<string, unknown> | null): string {
  if (!customer) return "-";
  const name = customer.full_name;
  const email = customer.email;
  return typeof name === "string"
    ? name
    : typeof email === "string"
      ? email
      : "-";
}

/**
 * BUG-COM-2 fix: Intl.NumberFormat already handles zero-decimal currencies
 * (JPY, KRW) correctly — it does NOT add fractional digits. However the value
 * stored server-side is always in the smallest unit (cents for BRL, yen for
 * JPY). We must NOT divide by 100 for zero-decimal currencies.
 */
const ZERO_DECIMAL_CURRENCIES = new Set([
  "JPY", "KRW", "VND", "IDR", "CLP", "TWD", "BIF", "GNF", "MGA",
  "PYG", "RWF", "UGX", "VUV", "XAF", "XOF", "XPF"
]);

function formatMinor(value: number, currency: string): string {
  const divisor = ZERO_DECIMAL_CURRENCIES.has(currency.toUpperCase()) ? 1 : 100;
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency,
  }).format(value / divisor);
}

/**
 * BUG-COM-3 fix: guard against absent or malformed date strings. Return a
 * locale-safe fallback ("—") instead of "Invalid Date".
 */
function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  if (isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(date);
}

// ── Page Component ───────────────────────────────────────────────────────────

export function OrdersShipmentsPage(props: { apiBaseUrl: string; me: MerchantProfile | null }) {
  const api = useMemo(() => createDashboardApi({ baseUrl: props.apiBaseUrl }), [props.apiBaseUrl]);
  const [orders, setOrders] = useState<TenantOrder[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [expandedOrderId, setExpandedOrderId] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<"all" | "approved" | "cancelled">("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [hasMore, setHasMore] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);

  useEffect(() => {
    if (!props.me) {
      setOrders([]);
      setHasLoaded(false);
      return;
    }
    void load();
  }, [props.me]); // eslint-disable-line react-hooks/exhaustive-deps

  async function load(cursor?: string) {
    setBusy(true);
    setMessage(null);
    try {
      const result: CursorPage<TenantOrder> = await api.getOrders(PAGE_SIZE, cursor);
      const items = Array.isArray(result?.data) ? result.data : Array.isArray(result) ? result as unknown as TenantOrder[] : [];
      if (cursor) {
        setOrders((prev) => [...prev, ...items]);
      } else {
        setOrders(items);
      }
      setNextCursor(result?.next_cursor ?? null);
      setHasMore(items.length === PAGE_SIZE);
      setHasLoaded(true);
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
    }
  }

  const metrics = useMemo(() => computeOrderMetrics(orders), [orders]);
  const filteredOrders = useMemo(
    () => filterOrders(orders, statusFilter, searchQuery),
    [orders, statusFilter, searchQuery],
  );

  if (!props.me) {
    return (
      <div className="dashboard-content">
        <header className="page-head">
          <div>
            <span className="eyebrow">Pedidos</span>
            <h1>Pedidos e Envios</h1>
            <p className="page-lead">Login necessário.</p>
          </div>
        </header>
      </div>
    );
  }

  return (
    <div className="dashboard-content">
      <header className="page-head">
        <div>
          <span className="eyebrow">Pedidos</span>
          <h1>Pedidos e Envios</h1>
          <p className="page-lead">Gerencie pedidos, acompanhe envios e monitore o status financeiro.</p>
        </div>
        <div className="button-row">
          <button
            type="button"
            onClick={() => {
              const header = "ID,Status,Valor,Moeda,Email,Criado em";
              const rows = filteredOrders.map((o) =>
                [o.id, o.financial_status ?? "", o.total_price_cents ?? 0, o.currency ?? "BRL", o.customer_email ?? "", o.created_at ?? ""].join(",")
              );
              const blob = new Blob([header + "\n" + rows.join("\n")], { type: "text/csv" });
              const url = URL.createObjectURL(blob);
              const a = document.createElement("a");
              a.href = url;
              a.download = `pedidos-${new Date().toISOString().slice(0, 10)}.csv`;
              a.click();
              URL.revokeObjectURL(url);
            }}
            disabled={filteredOrders.length === 0}
            aria-label="Exportar pedidos em CSV"
          >
            <Download size={16} />
            Exportar
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void load()}
            aria-label="Atualizar lista de pedidos"
          >
            <RefreshCw size={16} className={busy ? "spin" : ""} />
            Atualizar
          </button>
        </div>
      </header>

      {/* KPI Metrics Strip */}
      <div className="metrics">
        <div className="metric">
          <span><Package size={14} /> Pedidos</span>
          <strong>{hasLoaded ? metrics.totalOrders : "—"}</strong>
        </div>
        <div className="metric">
          <span><ShieldCheck size={14} /> Aprovados</span>
          <strong>{hasLoaded ? Math.round(metrics.approvalRate * 100) + "%" : "—"}</strong>
        </div>
        <div className="metric">
          <span><Activity size={14} /> Receita</span>
          <strong>{hasLoaded ? formatMinor(metrics.totalRevenue, "BRL") : "—"}</strong>
        </div>
        <div className="metric">
          <span><Truck size={14} /> Rastreados</span>
          <strong>{hasLoaded ? metrics.trackedCount : "—"}</strong>
        </div>
        <div className="metric">
          <span><Sparkles size={14} /> Ticket médio</span>
          <strong>{hasLoaded ? formatMinor(metrics.averageOrderValue, "BRL") : "—"}</strong>
        </div>
      </div>

      {message ? <p className="panel panel-error">{message}</p> : null}

      <section className="panel stacked">
        <div className="section-header">
          <h2>Pedidos</h2>
          <PackageSearch size={18} />
        </div>

        {/* Toolbar: filter tabs + search */}
        <div className="orders-toolbar">
          <nav className="filter-tabs" role="tablist" aria-label="Filtrar por status">
            {(["all", "approved", "cancelled"] as const).map((value) => {
              const labels = { all: "Todos", approved: "Aprovados", cancelled: "Cancelados" };
              return (
                <button
                  key={value}
                  role="tab"
                  className={`filter-tab${statusFilter === value ? " active" : ""}`}
                  aria-selected={statusFilter === value}
                  onClick={() => setStatusFilter(value)}
                  type="button"
                >
                  {labels[value]}
                </button>
              );
            })}
          </nav>
          <input
            type="search"
            className="search-input"
            placeholder="Buscar por ID do pedido ou cliente..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            aria-label="Buscar pedidos por ID ou nome do cliente"
          />
        </div>

        {/* Accessible loading announcer */}
        <div aria-live="polite" className="sr-only">
          {busy && !hasLoaded ? "Carregando pedidos..." : ""}
          {hasLoaded ? `${filteredOrders.length} pedidos exibidos` : ""}
        </div>

        {busy && !hasLoaded ? (
          <div className="empty-state">
            <div className="skeleton" style={{ width: "100%", height: 200 }} />
          </div>
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <caption className="sr-only">Lista de pedidos do merchant</caption>
              <thead>
                <tr>
                  <th>Pedido</th>
                  <th>Cliente</th>
                  <th>Total</th>
                  <th>Rastreamento</th>
                  <th>Status</th>
                  <th>Concluído</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {filteredOrders.map((order) => (
                  <React.Fragment key={order.id}>
                    <tr
                      className="order-row-clickable"
                      onClick={() =>
                        setExpandedOrderId(
                          expandedOrderId === order.id ? null : order.id,
                        )
                      }
                      aria-expanded={expandedOrderId === order.id}
                      aria-controls={`order-detail-${order.id}`}
                    >
                      <td><code>{order.external_order_id}</code></td>
                      <td>{customerLabel(order.customer)}</td>
                      <td>{formatMinor(order.total, order.currency)}</td>
                      <td><code>{order.tracking_code ?? "Pendente"}</code></td>
                      <td>
                        <span className={orderBadgeClass(order.status)}>
                          {STATUS_LABELS[order.status] ?? order.status}
                        </span>
                      </td>
                      <td>{formatDate(order.completed_at)}</td>
                      <td>{expandedOrderId === order.id ? "▲" : "▼"}</td>
                    </tr>
                    {expandedOrderId === order.id ? (
                      <tr
                        className="order-detail-panel"
                        id={`order-detail-${order.id}`}
                      >
                        <td colSpan={7}>
                          <OrderDetailGrid order={order} />
                        </td>
                      </tr>
                    ) : null}
                  </React.Fragment>
                ))}
                {busy && hasLoaded ? (
                  <tr>
                    <td colSpan={7} className="muted">Carregando...</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        )}

        {/* BUG-COM-1 fix: show empty-state only after a successful load with zero
            results, never during fetch, never when there's an error. */}
        {hasLoaded && orders.length === 0 && !message && !busy ? (
          <div className="empty-state">
            <div className="empty-state-icon">
              <PackageSearch size={32} />
            </div>
            <h3>Nenhum pedido encontrado</h3>
            <p>Os pedidos aparecerão aqui assim que forem sincronizados com sua loja.</p>
          </div>
        ) : null}

        {/* No results from active filter */}
        {hasLoaded && orders.length > 0 && filteredOrders.length === 0 && !busy ? (
          <div className="empty-state">
            <h3>Nenhum pedido corresponde ao filtro</h3>
          </div>
        ) : null}
      </section>

      {/* Pagination */}
      {hasMore && !busy ? (
        <div className="load-more-row">
          <button
            type="button"
            className="load-more"
            onClick={() => void load(nextCursor ?? undefined)}
          >
            Carregar mais
          </button>
        </div>
      ) : null}
    </div>
  );
}

// ── Order Detail Grid (private) ──────────────────────────────────────────────

function OrderDetailGrid({ order }: { order: TenantOrder }) {
  const cart = order.cart as { items?: Array<{ name?: string; title?: string; quantity?: number; price?: number }> };
  const items = Array.isArray(cart?.items) ? cart.items : [];
  const customer = order.customer as {
    full_name?: string;
    email?: string;
    phone?: string;
  } | null;

  return (
    <div className="order-detail-grid">
      <section>
        <h4>Itens do carrinho</h4>
        {items.length > 0 ? (
          <ul>
            {items.map((item, i) => (
              <li key={i}>
                {item.name ?? item.title ?? "Item"}
                {item.quantity ? ` × ${item.quantity}` : ""}
                {item.price ? ` — ${formatMinor(item.price, order.currency)}` : ""}
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted">Nenhum item disponível</p>
        )}
      </section>

      <section>
        <h4>Cliente</h4>
        {customer ? (
          <dl>
            {customer.full_name ? <><dt>Nome</dt><dd>{customer.full_name}</dd></> : null}
            {customer.email ? <><dt>Email</dt><dd>{customer.email}</dd></> : null}
            {customer.phone ? <><dt>Telefone</dt><dd>{customer.phone}</dd></> : null}
          </dl>
        ) : (
          <p className="muted">Sem informações do cliente</p>
        )}
      </section>

      <section>
        <h4>Envio</h4>
        <p>{order.tracking_code ? order.tracking_code : "Sem rastreamento"}</p>
      </section>

      {order.cancellation_reason ? (
        <section>
          <h4>Cancelamento</h4>
          <p>{order.cancellation_reason}</p>
          <p className="muted">{formatDate(order.cancelled_at)}</p>
        </section>
      ) : null}
    </div>
  );
}
