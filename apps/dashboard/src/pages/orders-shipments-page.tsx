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
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!props.me) {
      setOrders([]);
      return;
    }
    void load();
  }, [props.me]); // eslint-disable-line react-hooks/exhaustive-deps

  async function load() {
    setBusy(true);
    setMessage(null);
    try {
      setOrders(await api.getOrders(50));
    } catch (e) {
      setMessage(e instanceof DashboardHttpError ? e.responseBody.slice(0, 160) : e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  if (!props.me) {
    return (
      <>
        <h1>Pedidos e envios</h1>
        <p className="page-lead">Login necessario.</p>
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
        <button type="button" disabled={busy} onClick={() => void load()}>
          <RefreshCw size={16} />
          Atualizar
        </button>
      </header>
      {message ? <p className="panel panel-info">{message}</p> : null}
      <section className="panel stacked">
        <div className="panel-title">
          <h2>Pedidos</h2>
          <PackageSearch size={18} />
        </div>
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
                  <td>{order.external_order_id}</td>
                  <td>{customerLabel(order.customer)}</td>
                  <td>{formatMinor(order.total, order.currency)}</td>
                  <td><code>{order.tracking_code ?? "pendente"}</code></td>
                  <td>
                    <span className={order.status === "approved" ? "badge ok" : "badge bad"}>{order.status}</span>
                  </td>
                  <td>{formatDate(order.completed_at)}</td>
                </tr>
              ))}
              {orders.length === 0 ? (
                <tr>
                  <td colSpan={6}>Nenhum envio encontrado.</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
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

function formatMinor(value: number, currency: string): string {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency,
  }).format(value / 100);
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(value));
}
