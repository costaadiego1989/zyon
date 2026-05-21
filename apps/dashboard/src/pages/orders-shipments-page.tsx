import React, { useEffect, useMemo, useState } from "react";
import { ExternalLink, RefreshCw, Truck } from "lucide-react";
import { createDashboardApi, DashboardHttpError, type MerchantProfile, type TenantShipment } from "../api-client.js";

export function OrdersShipmentsPage(props: { apiBaseUrl: string; me: MerchantProfile | null }) {
  const api = useMemo(() => createDashboardApi({ baseUrl: props.apiBaseUrl }), [props.apiBaseUrl]);
  const [shipments, setShipments] = useState<TenantShipment[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!props.me) {
      setShipments([]);
      return;
    }
    void load();
  }, [props.me]); // eslint-disable-line react-hooks/exhaustive-deps

  async function load() {
    setBusy(true);
    setMessage(null);
    try {
      setShipments(await api.getTenantShipments(50));
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
          <p className="page-lead">Pedidos com tracking recebido pelo backend do tenant.</p>
        </div>
        <button type="button" disabled={busy} onClick={() => void load()}>
          <RefreshCw size={16} />
          Atualizar
        </button>
      </header>
      {message ? <p className="panel panel-info">{message}</p> : null}
      <section className="panel stacked">
        <div className="panel-title">
          <h2>Shipments</h2>
          <Truck size={18} />
        </div>
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Pedido</th>
                <th>Sessao</th>
                <th>Carrier</th>
                <th>Tracking</th>
                <th>Status</th>
                <th>Atualizado</th>
              </tr>
            </thead>
            <tbody>
              {shipments.map((shipment) => (
                <tr key={shipment.id}>
                  <td>{shipment.externalOrderId}</td>
                  <td>{shipment.sessionId}</td>
                  <td>{shipment.carrier}</td>
                  <td>
                    {shipment.trackingUrl ? (
                      <a href={shipment.trackingUrl} target="_blank" rel="noreferrer">
                        {shipment.trackingCode}
                        <ExternalLink size={12} />
                      </a>
                    ) : (
                      <code>{shipment.trackingCode}</code>
                    )}
                  </td>
                  <td>
                    <span className={shipment.status === "delivered" ? "badge ok" : "badge"}>{shipment.status}</span>
                  </td>
                  <td>{shipment.updatedAt}</td>
                </tr>
              ))}
              {shipments.length === 0 ? (
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
