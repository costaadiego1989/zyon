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
import { Pagination } from "../components/Pagination.js";
import {
  type CursorPage,
  type MerchantProfile,
  type TenantOrder,
} from "../api-client.js";
import { useApi } from "../hooks/useApi.js";
import { downloadCsv } from "../hooks/useCsvExport.js";
import { DashboardHttpError } from "../api/http/index.js";

// ── Constants ────────────────────────────────────────────────────────────────

const PAGE_SIZE = 50;

export const STATUS_LABELS: Record<string, string> = {
  approved: "Aprovado",
  cancelled: "Cancelado",
  pending: "Aguardando",
  shipped: "Em trânsito",
  delivered: "Entregue",
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
  const api = useApi();
  const [orders, setOrders] = useState<TenantOrder[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [expandedOrderId, setExpandedOrderId] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<"all" | "approved" | "cancelled">("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [hasMore, setHasMore] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [trackingDrafts, setTrackingDrafts] = useState<Record<string, string>>({});
  const [labelBusyOrderId, setLabelBusyOrderId] = useState<string | null>(null);
  const PAGE_SIZE = 10;

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
  const paginatedOrders = useMemo(() => {
    const start = (page - 1) * PAGE_SIZE;
    return filteredOrders.slice(start, start + PAGE_SIZE);
  }, [filteredOrders, page]);

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

  const exportCsv = () => {
    const header = "ID,Status,Valor,Moeda,Cliente,Criado em";
    const rows = filteredOrders.map((o: TenantOrder) => {
      const customer = o.customer as { full_name?: unknown; email?: unknown } | null;
      const name = typeof customer?.full_name === "string" ? customer.full_name : "";
      const email = typeof customer?.email === "string" ? customer.email : "";
      const label = name || email || "-";
      const createdAt = o.completed_at ?? o.cancelled_at ?? "";
      return [o.id, o.status, String(o.total), o.currency, label, createdAt].join(",");
    });
    downloadCsv(header, rows, `pedidos-${new Date().toISOString().slice(0, 10)}.csv`);
  };

  async function saveManualTracking(order: TenantOrder) {
    const trackingCode = (trackingDrafts[order.id] ?? "").trim();
    if (!trackingCode) {
      setMessage("Informe o código de rastreio.");
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      await api.updateOrderTracking(order.id, {
        tracking_code: trackingCode,
        carrier: "manual",
        status: "label_generated",
      });
      setOrders((prev) => prev.map((item) => item.id === order.id ? { ...item, tracking_code: trackingCode } : item));
      setTrackingDrafts((prev) => ({ ...prev, [order.id]: "" }));
      setMessage("Rastreio atualizado e webhook disparado.");
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function buyLabel(order: TenantOrder) {
    const customer = order.customer as { full_name?: string; document?: string; address?: { zip?: string } } | null;
    const cart = order.cart as { items?: Array<{ quantity?: number }> };
    setLabelBusyOrderId(order.id);
    setMessage(null);
    try {
      const result = await api.purchaseShippingLabel({
        order_id: order.external_order_id,
        service_id: 1,
        from_zip: (order as any).merchant_origin_zip ?? "",
        to_zip: customer?.address?.zip ?? "",
        to_name: customer?.full_name ?? "",
        to_document: customer?.document ?? "",
        packages: [{ weightKg: 1, widthCm: 20, heightCm: 10, lengthCm: 20, quantity: Math.max(1, cart.items?.[0]?.quantity ?? 1) }],
      }) as { tracking_code?: string };
      if (result.tracking_code) {
        setOrders((prev) => prev.map((item) => item.id === order.id ? { ...item, tracking_code: result.tracking_code ?? item.tracking_code } : item));
      }
      setMessage("Etiqueta comprada e rastreio sincronizado.");
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e));
    } finally {
      setLabelBusyOrderId(null);
    }
  }

  async function changeOrderStatus(order: TenantOrder, status: string) {
    setBusy(true);
    setMessage(null);
    try {
      await api.updateOrderStatus(order.id, status);
      setOrders((prev) => prev.map((item) => item.id === order.id ? { ...item, status } : item));
      setMessage(`Status atualizado para "${STATUS_LABELS[status] ?? status}".`);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div style={{ marginBottom: 20 }}>
        <div style={{ font: "600 10px var(--mono)", letterSpacing: "0.06em", color: "var(--faint)", marginBottom: 4 }}>COMÉRCIO</div>
        <h1 style={{ font: "700 22px var(--serif)", color: "var(--ink)", letterSpacing: "-0.02em", marginBottom: 6 }}>Pedidos e Envios</h1>
        <div style={{ font: "17px var(--serif)", fontStyle: "italic", color: "var(--muted)" }}>Acompanhe pedidos e envios gerados pelo checkout agêntico.</div>
      </div>

      {/* Stats strip */}
      <div style={{ display: "flex", background: "var(--card)", border: "1px solid var(--border)", borderRadius: 14, marginBottom: 20 }}>
        {[
          { label: "PEDIDOS", value: hasLoaded ? metrics.totalOrders : "—" },
          { label: "APROVADOS", value: hasLoaded ? Math.round(metrics.approvalRate * 100) + "%" : "—" },
          { label: "RECEITA", value: hasLoaded ? formatMinor(metrics.totalRevenue, "BRL") : "—" },
          { label: "RASTREADOS", value: hasLoaded ? metrics.trackedCount : "—" },
          { label: "TICKET MÉDIO", value: hasLoaded ? formatMinor(metrics.averageOrderValue, "BRL") : "—" },
        ].map((st) => (
          <div key={st.label} style={{ flex: 1, padding: "18px 22px", borderRight: "1px solid var(--border)" }}>
            <div style={{ font: "600 10px var(--mono)", letterSpacing: "0.07em", color: "var(--faint)", marginBottom: 9 }}>{st.label}</div>
            <div style={{ font: "500 25px var(--serif)", color: "var(--ink)", letterSpacing: "-0.01em" }}>{String(st.value)}</div>
          </div>
        ))}
      </div>

      {message ? <div style={{ padding: "12px 16px", borderRadius: 8, background: "var(--danger-soft)", border: "1px solid var(--danger)", font: "13px var(--sans)", color: "var(--danger)", marginBottom: 16 }}>{message}</div> : null}

      {/* Orders table card */}
      <div style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 14, overflow: "hidden" }}>
        {/* Toolbar: tabs + search */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "16px 22px", borderBottom: "1px solid var(--border)" }}>
          <div style={{ display: "flex", gap: 8 }}>
            {(["all", "approved", "cancelled"] as const).map((value) => {
              const labels = { all: "Todos os pedidos", approved: "Aprovados", cancelled: "Cancelados" };
              const active = statusFilter === value;
              return (
                <div
                  key={value}
                  onClick={() => setStatusFilter(value)}
                  style={{ padding: "7px 14px", borderRadius: 8, font: "600 12.5px var(--sans)", cursor: "pointer", background: active ? "var(--accent-dark)" : "var(--card)", color: active ? "white" : "var(--ink)", border: `1px solid ${active ? "var(--accent-dark)" : "var(--border)"}` }}
                >
                  {labels[value]}
                </div>
              );
            })}
          </div>
          <input
            placeholder="Buscar por ID do pedido ou cliente..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            style={{ width: 280, padding: "8px 12px", borderRadius: 8, border: "1px solid var(--border)", font: "13px var(--sans)", color: "var(--ink)", outline: "none", background: "var(--bg)" }}
          />
        </div>

        {busy && !hasLoaded ? (
          <div style={{ padding: "40px 22px", textAlign: "center", color: "var(--faint)", font: "13px var(--sans)" }}>Carregando pedidos...</div>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead><tr>
              {["PEDIDO", "COMPRADOR", "VALOR", "RASTREIO", "STATUS", "DATA"].map((c) => (
                <th key={c} style={{ textAlign: "left", padding: "10px 22px", font: "600 10.5px var(--mono)", letterSpacing: "0.05em", color: "var(--faint)", borderBottom: "1px solid var(--border)" }}>{c}</th>
              ))}
            </tr></thead>
            <tbody>
              {paginatedOrders.map((order) => {
                const initial = customerLabel(order.customer).charAt(0).toUpperCase();
                const statusBg = order.status === "approved" ? "var(--good-soft)" : order.status === "cancelled" ? "var(--danger-soft)" : "var(--accent-soft)";
                const statusColor = order.status === "approved" ? "var(--good)" : order.status === "cancelled" ? "var(--danger)" : "var(--accent-dark)";
                return (
                  <React.Fragment key={order.id}>
                    <tr
                      onClick={() => setExpandedOrderId(expandedOrderId === order.id ? null : order.id)}
                      style={{ cursor: "pointer" }}
                    >
                      <td style={{ padding: "12px 22px", font: "600 13px var(--mono)", color: "var(--ink)", borderBottom: "1px solid var(--border)" }}>{order.external_order_id}</td>
                      <td style={{ padding: "12px 22px", borderBottom: "1px solid var(--border)" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
                          <div style={{ width: 24, height: 24, borderRadius: "50%", background: "var(--accent-soft)", color: "var(--accent-dark)", display: "flex", alignItems: "center", justifyContent: "center", font: "600 10px var(--sans)", flex: "none" }}>{initial}</div>
                          <span style={{ font: "13px var(--sans)", color: "var(--ink)" }}>{customerLabel(order.customer)}</span>
                        </div>
                      </td>
                      <td style={{ padding: "12px 22px", font: "600 13px var(--mono)", color: "var(--ink)", borderBottom: "1px solid var(--border)" }}>{formatMinor(order.total, order.currency)}</td>
                      <td style={{ padding: "12px 22px", font: "12.5px var(--mono)", color: "var(--muted)", borderBottom: "1px solid var(--border)" }}>{order.tracking_code ?? "Aguardando"}</td>
                      <td style={{ padding: "12px 22px", borderBottom: "1px solid var(--border)" }}>
                        <span style={{ font: "600 11px var(--sans)", padding: "4px 9px", borderRadius: 99, background: statusBg, color: statusColor }}>{STATUS_LABELS[order.status] ?? order.status}</span>
                      </td>
                      <td style={{ padding: "12px 22px", font: "13px var(--mono)", color: "var(--muted)", borderBottom: "1px solid var(--border)" }}>{formatDate(order.completed_at)}</td>
                    </tr>
                  </React.Fragment>
                );
              })}
              {busy && hasLoaded ? (
                <tr><td colSpan={6} style={{ padding: "12px 22px", color: "var(--faint)", font: "13px var(--sans)" }}>Carregando...</td></tr>
              ) : null}
            </tbody>
          </table>
        )}

        {hasLoaded && orders.length === 0 && !message && !busy ? (
          <div style={{ padding: "40px 22px", textAlign: "center", display: "flex", flexDirection: "column", alignItems: "center", gap: 8, color: "var(--faint)" }}>
            <PackageSearch size={32} />
            <strong style={{ font: "600 13px var(--sans)", color: "var(--ink)" }}>Nenhum pedido registrado</strong>
            <p style={{ font: "12.5px var(--sans)", color: "var(--faint)" }}>Pedidos aparecerão aqui quando compradores concluírem o checkout.</p>
          </div>
        ) : null}

        {hasLoaded && orders.length > 0 && filteredOrders.length === 0 && !busy ? (
          <div style={{ padding: "30px 22px", textAlign: "center", font: "13px var(--sans)", color: "var(--faint)" }}>Nenhum pedido corresponde ao filtro</div>
        ) : null}
      </div>

      {/* Pagination */}
      {hasLoaded && filteredOrders.length > 0 ? (
        <Pagination
          page={page}
          pageSize={PAGE_SIZE}
          total={filteredOrders.length}
          onChange={setPage}
          disabled={busy}
        />
      ) : null}

      {/* Side Panel */}
      {expandedOrderId && (() => {
        const order = orders.find((o) => o.id === expandedOrderId);
        if (!order) return null;
        return (
          <div style={{ position: "fixed", inset: 0, zIndex: 900, display: "flex", justifyContent: "flex-end" }} onClick={() => setExpandedOrderId(null)}>
            <div style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.5)", backdropFilter: "blur(2px)" }} />
            <aside style={{ position: "relative", width: 480, maxWidth: "90vw", height: "100vh", overflowY: "auto", background: "var(--color-surface)", borderLeft: "1px solid var(--color-border)", padding: "28px 24px", display: "flex", flexDirection: "column", gap: 20, animation: "slideInRight 0.2s ease-out" }} onClick={(e) => e.stopPropagation()}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <h2 style={{ font: "600 18px var(--font-sans)", color: "var(--color-text)", margin: 0 }}>Pedido {order.external_order_id}</h2>
                <button type="button" onClick={() => setExpandedOrderId(null)} style={{ background: "none", border: "none", color: "var(--color-text-muted)", cursor: "pointer", font: "20px sans-serif" }}>×</button>
              </div>
              <OrderDetailGrid
                order={order}
                trackingDraft={trackingDrafts[order.id] ?? ""}
                onTrackingDraftChange={(value) => setTrackingDrafts((prev) => ({ ...prev, [order.id]: value }))}
                onSaveTracking={() => void saveManualTracking(order)}
                onBuyLabel={() => void buyLabel(order)}
                onStatusChange={(status) => void changeOrderStatus(order, status)}
                labelBusy={labelBusyOrderId === order.id}
                busy={busy}
              />
            </aside>
          </div>
        );
      })()}
    </div>
  );
}

// ── Order Detail Grid (private) ──────────────────────────────────────────────

function OrderDetailGrid({
  order,
  trackingDraft,
  onTrackingDraftChange,
  onSaveTracking,
  onBuyLabel,
  onStatusChange,
  labelBusy,
  busy,
}: {
  order: TenantOrder;
  trackingDraft: string;
  onTrackingDraftChange: (value: string) => void;
  onSaveTracking: () => void;
  onBuyLabel: () => void;
  onStatusChange: (status: string) => void;
  labelBusy: boolean;
  busy: boolean;
}) {
  const cart = order.cart as { items?: Array<{ name?: string; title?: string; quantity?: number; price?: number; unit_price?: number }> };
  const items = Array.isArray(cart?.items) ? cart.items : [];
  const customer = order.customer as { full_name?: string; email?: string; phone?: string } | null;

  const sectionStyle: React.CSSProperties = { padding: "16px 0", borderBottom: "1px solid var(--color-border)" };
  const labelStyle: React.CSSProperties = { font: "600 11px var(--font-mono)", letterSpacing: "0.04em", color: "var(--color-text-muted)", marginBottom: 10, textTransform: "uppercase" as const };
  const valueStyle: React.CSSProperties = { font: "13px var(--font-sans)", color: "var(--color-text)" };

  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      {/* Status badge */}
      <div style={{ ...sectionStyle, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div>
          <div style={labelStyle}>Status atual</div>
          <span style={{ font: "600 12px var(--font-sans)", padding: "5px 12px", borderRadius: 99, background: order.status === "approved" ? "var(--color-success-bg)" : order.status === "processing" ? "var(--color-warning-bg)" : "var(--color-surface-raised)", color: order.status === "approved" ? "var(--color-success)" : order.status === "processing" ? "var(--color-warning)" : "var(--color-text)", border: "1px solid var(--color-border)" }}>
            {STATUS_LABELS[order.status] ?? order.status}
          </span>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={labelStyle}>Total</div>
          <span style={{ font: "700 18px var(--font-mono)", color: "var(--color-text)" }}>{formatMinor(order.order_total * 100, order.currency)}</span>
        </div>
      </div>

      {/* Items */}
      <div style={sectionStyle}>
        <div style={labelStyle}>Itens ({items.length})</div>
        {items.length > 0 ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {items.map((item, i) => (
              <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 12px", borderRadius: 8, background: "var(--color-surface-raised)", border: "1px solid var(--color-border)" }}>
                <span style={valueStyle}>{item.name ?? item.title ?? "Item"} <span style={{ color: "var(--color-text-muted)" }}>×{item.quantity ?? 1}</span></span>
                <span style={{ font: "600 12px var(--font-mono)", color: "var(--color-text-secondary)" }}>{item.price || item.unit_price ? formatMinor(item.price ?? item.unit_price ?? 0, order.currency) : ""}</span>
              </div>
            ))}
          </div>
        ) : <p style={{ ...valueStyle, color: "var(--color-text-muted)" }}>Nenhum item</p>}
      </div>

      {/* Customer */}
      <div style={sectionStyle}>
        <div style={labelStyle}>Cliente</div>
        {customer ? (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px 16px" }}>
            {customer.full_name && <div><span style={{ font: "11px var(--font-sans)", color: "var(--color-text-muted)" }}>Nome</span><div style={valueStyle}>{customer.full_name}</div></div>}
            {customer.email && <div><span style={{ font: "11px var(--font-sans)", color: "var(--color-text-muted)" }}>Email</span><div style={valueStyle}>{customer.email}</div></div>}
            {customer.phone && <div><span style={{ font: "11px var(--font-sans)", color: "var(--color-text-muted)" }}>Telefone</span><div style={valueStyle}>{customer.phone}</div></div>}
          </div>
        ) : <p style={{ ...valueStyle, color: "var(--color-text-muted)" }}>Sem dados do cliente</p>}
      </div>

      {/* Tracking */}
      <div style={sectionStyle}>
        <div style={labelStyle}>Rastreamento</div>
        {order.tracking_code ? (
          <div style={{ padding: "10px 14px", borderRadius: 8, background: "var(--color-success-bg)", border: "1px solid var(--color-success)", marginBottom: 12 }}>
            <span style={{ font: "600 13px var(--font-mono)", color: "var(--color-success)" }}>{order.tracking_code}</span>
          </div>
        ) : (
          <p style={{ ...valueStyle, color: "var(--color-text-muted)", marginBottom: 12 }}>Sem código de rastreio</p>
        )}
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <input
            placeholder="Inserir código de rastreio"
            value={trackingDraft}
            onChange={(e) => onTrackingDraftChange(e.target.value)}
            style={{ flex: 1, padding: "10px 14px", borderRadius: 8, border: "1px solid var(--color-border)", background: "var(--color-surface-raised)", color: "var(--color-text)", font: "13px var(--font-mono)" }}
          />
          <button
            type="button"
            onClick={onSaveTracking}
            disabled={busy || !trackingDraft.trim()}
            style={{ padding: "10px 16px", borderRadius: 8, border: "none", background: "var(--color-brand)", color: "white", font: "600 12px var(--font-sans)", cursor: busy ? "not-allowed" : "pointer", opacity: busy || !trackingDraft.trim() ? 0.5 : 1, whiteSpace: "nowrap" }}
          >
            Salvar
          </button>
        </div>
        <button
          type="button"
          onClick={onBuyLabel}
          disabled={labelBusy}
          style={{ marginTop: 10, padding: "9px 14px", borderRadius: 8, border: "1px solid var(--color-border)", background: "var(--color-surface-raised)", color: "var(--color-text)", font: "500 12px var(--font-sans)", cursor: labelBusy ? "not-allowed" : "pointer", display: "flex", alignItems: "center", gap: 6 }}
        >
          <Truck size={14} />
          {labelBusy ? "Gerando etiqueta..." : "Gerar etiqueta de envio"}
        </button>
      </div>

      {/* Status update */}
      <div style={{ ...sectionStyle, borderBottom: "none" }}>
        <div style={labelStyle}>Alterar status</div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {(["processing", "shipped", "delivered", "cancelled"] as const).map((status) => {
            const labels: Record<string, string> = { processing: "Processando", shipped: "Enviado", delivered: "Entregue", cancelled: "Cancelado" };
            const isActive = order.status === status;
            return (
              <button
                key={status}
                type="button"
                onClick={() => onStatusChange(status)}
                disabled={busy || isActive}
                style={{
                  padding: "8px 14px",
                  borderRadius: 8,
                  border: `1px solid ${isActive ? "var(--color-brand)" : "var(--color-border)"}`,
                  background: isActive ? "var(--color-brand)" : "var(--color-surface-raised)",
                  color: isActive ? "white" : "var(--color-text)",
                  font: "600 12px var(--font-sans)",
                  cursor: busy || isActive ? "not-allowed" : "pointer",
                  opacity: isActive ? 1 : 0.85,
                  transition: "all 0.15s ease",
                }}
              >
                {labels[status]}
              </button>
            );
          })}
        </div>
      </div>

      {order.cancellation_reason ? (
        <div style={{ padding: "12px 14px", borderRadius: 8, background: "var(--color-error-bg)", border: "1px solid var(--color-error-border)", marginTop: 12 }}>
          <div style={{ font: "600 11px var(--font-sans)", color: "var(--color-error)", marginBottom: 4 }}>Motivo do cancelamento</div>
          <div style={{ font: "13px var(--font-sans)", color: "var(--color-text)" }}>{order.cancellation_reason}</div>
        </div>
      ) : null}
    </div>
  );
}

