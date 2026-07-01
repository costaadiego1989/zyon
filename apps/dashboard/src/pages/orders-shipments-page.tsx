import React, { useEffect, useMemo, useState } from "react";
import { PackageSearch, RefreshCw } from "lucide-react";
import {
  createDashboardApi,
  DashboardHttpError,
  type MerchantProfile,
  type TenantOrder,
} from "../api-client.js";

export function OrdersShipmentsPage(props: { apiBaseUrl: string; me: MerchantProfile | null }) {
  const api = useMemo(() => createDashboardApi({ baseUrl: props.apiBaseUrl }), [props.apiBaseUrl]);
  const [orders, setOrders] = useState<TenantOrder[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  // BUG-COM-1 fix: separate `loading` flag from `busy` so we can distinguish
  // "first load in progress" (show loading row) from "empty data" (show
  // empty-state row) and from "error" (show error banner but not empty-state).
  const [busy, setBusy] = useState(false);
  const [hasLoaded, setHasLoaded] = useState(false);

  useEffect(() => {
    if (!props.me) {
      setOrders([]);
      setHasLoaded(false);
      return;
    }
    void load();
  }, [props.me]); // eslint-disable-line react-hooks/exhaustive-deps

  async function load() {
    setBusy(true);
    setMessage(null);
    try {
      setOrders(await api.getOrders(50));
      setHasLoaded(true);
    } catch (e) {
      setMessage(e instanceof DashboardHttpError ? e.responseBody.slice(0, 160) : e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  if (!props.me) {
    return (
      <>
        <header className="page-head">
          <div>
            <h1>Pedidos e envios</h1>
            <p className="page-lead">Login necessario.</p>
          </div>
        </header>
      </>
    );
  }

  return (
    <>
      <header className="page-head">
        <div>
          <h1>Pedidos e envios</h1>
          <p className="page-lead">Pedidos reais, status financeiro e tracking do tenant autenticado.</p>
        </div>
        <div className="button-row">
          <button type="button" disabled={busy} onClick={() => void load()}>
            <RefreshCw size={16} />
            Atualizar
          </button>
        </div>
      </header>

      {message ? <p className="panel panel-error">{message}</p> : null}

      <section className="panel stacked">
        <div className="panel-title">
          <h2>Pedidos</h2>
          <PackageSearch size={18} />
        </div>

        {busy && !hasLoaded ? (
          <div className="empty-state">
            <div className="skeleton" style={{ width: "100%", height: 200 }} />
          </div>
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Pedido</th>
                  <th>Cliente</th>
                  <th>Total</th>
                  <th>Tracking</th>
                  <th>Status</th>
                  <th>Concluido</th>
                </tr>
              </thead>
              <tbody>
                {orders.map((order) => (
                  <tr key={order.id}>
                    <td><code>{order.external_order_id}</code></td>
                    <td>{customerLabel(order.customer)}</td>
                    <td>{formatMinor(order.total, order.currency)}</td>
                    <td><code>{order.tracking_code ?? "pendente"}</code></td>
                    <td>
                      <span className={orderBadgeClass(order.status)}>{order.status}</span>
                    </td>
                    <td>{formatDate(order.completed_at)}</td>
                  </tr>
                ))}
                {busy && hasLoaded ? (
                  <tr>
                    <td colSpan={6} className="muted">Carregando...</td>
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
            <p>Os pedidos do tenant aparecerão aqui assim que forem sincronizados.</p>
          </div>
        ) : null}
      </section>
    </>
  );
}

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
 *
 * Zero-decimal ISO 4217 codes: JPY, KRW, VND, IDR, CLP, TWD, BIF, GNF, MGA,
 * PYG, RWF, UGX, VUV, XAF, XOF, XPF.
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
