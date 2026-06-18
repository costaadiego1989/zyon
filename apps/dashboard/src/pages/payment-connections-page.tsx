import React, { useEffect, useMemo, useState } from "react";
import { ExternalLink, RefreshCw, Trash2, Zap } from "lucide-react";
import {
  createDashboardApi,
  DashboardHttpError,
  type PaymentConnection,
  type MerchantProfile,
} from "../api-client.js";

function readError(e: unknown): string {
  return e instanceof DashboardHttpError
    ? e.responseBody.slice(0, 240) || `HTTP ${e.status}`
    : e instanceof Error
      ? e.message
      : String(e);
}

function formatDate(iso: string): string {
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(
    new Date(iso),
  );
}

export function PaymentConnectionsPage(props: { apiBaseUrl: string; me: MerchantProfile | null }) {
  const api = useMemo(() => createDashboardApi({ baseUrl: props.apiBaseUrl }), [props.apiBaseUrl]);
  const [connections, setConnections] = useState<PaymentConnection[]>([]);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!props.me) {
      setConnections([]);
      return;
    }
    void load();
  }, [props.me]); // eslint-disable-line react-hooks/exhaustive-deps

  async function load() {
    setLoading(true);
    setMessage(null);
    try {
      setConnections(await api.getPaymentConnections());
    } catch (e) {
      setMessage(readError(e));
    } finally {
      setLoading(false);
    }
  }

  async function onboardStripe() {
    setBusy(true);
    setMessage(null);
    try {
      const { url } = await api.createStripeOnboardingLink({
        return_url: window.location.href,
        refresh_url: window.location.href,
      });
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (e) {
      setMessage(readError(e));
    } finally {
      setBusy(false);
    }
  }

  async function syncStripe() {
    setBusy(true);
    setMessage(null);
    try {
      const updated = await api.syncStripeConnection();
      setConnections((prev) => {
        const idx = prev.findIndex((c) => c.id === updated.id);
        return idx >= 0 ? prev.map((c, i) => (i === idx ? updated : c)) : [updated, ...prev];
      });
      setMessage("Stripe sincronizado.");
    } catch (e) {
      setMessage(readError(e));
    } finally {
      setBusy(false);
    }
  }

  async function onboardAsaas() {
    setBusy(true);
    setMessage(null);
    try {
      const { url } = await api.createAsaasOnboardingLink({ return_url: window.location.href });
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (e) {
      setMessage(readError(e));
    } finally {
      setBusy(false);
    }
  }

  async function syncAsaas() {
    setBusy(true);
    setMessage(null);
    try {
      const updated = await api.syncAsaasConnection();
      setConnections((prev) => {
        const idx = prev.findIndex((c) => c.id === updated.id);
        return idx >= 0 ? prev.map((c, i) => (i === idx ? updated : c)) : [updated, ...prev];
      });
      setMessage("Asaas sincronizado.");
    } catch (e) {
      setMessage(readError(e));
    } finally {
      setBusy(false);
    }
  }

  if (!props.me) {
    return (
      <>
        <h1>Conexões de pagamento</h1>
        <p className="page-lead">Login necessario para gerenciar contas de recebimento.</p>
      </>
    );
  }

  const stripeConn = connections.find((c) => c.provider === "stripe");
  const asaasConn = connections.find((c) => c.provider === "asaas");

  return (
    <>
      <header className="page-head">
        <div>
          <h1>Conexões de pagamento</h1>
          <p className="page-lead">Conecte contas de recebimento (Stripe, Asaas) para processar transacoes.</p>
        </div>
        <button type="button" disabled={loading || busy} onClick={() => void load()}>
          <RefreshCw size={16} />
          Atualizar
        </button>
      </header>

      {message ? <p className="panel panel-info">{message}</p> : null}
      {loading ? <p className="panel panel-info">Carregando...</p> : null}

      {/* Stripe */}
      <section className="panel stacked">
        <div className="panel-title">
          <h2>Stripe</h2>
          <Zap size={18} />
        </div>
        {stripeConn ? (
          <dl className="detail-list">
            <dt>Status</dt>
            <dd>
              <span className={stripeConn.status === "active" ? "badge ok" : "badge bad"}>
                {stripeConn.status}
              </span>
            </dd>
            {stripeConn.account_id ? (
              <>
                <dt>Conta</dt>
                <dd>
                  <code>{stripeConn.account_id}</code>
                </dd>
              </>
            ) : null}
            <dt>Atualizado</dt>
            <dd>{formatDate(stripeConn.updated_at)}</dd>
          </dl>
        ) : (
          <p>Nenhuma conta Stripe conectada.</p>
        )}
        <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
          <button type="button" disabled={busy} onClick={() => void onboardStripe()}>
            <ExternalLink size={16} />
            Conectar Stripe
          </button>
          {stripeConn ? (
            <button type="button" disabled={busy} onClick={() => void syncStripe()}>
              <RefreshCw size={16} />
              Sincronizar
            </button>
          ) : null}
        </div>
      </section>

      {/* Asaas */}
      <section className="panel stacked">
        <div className="panel-title">
          <h2>Asaas</h2>
          <Zap size={18} />
        </div>
        {asaasConn ? (
          <dl className="detail-list">
            <dt>Status</dt>
            <dd>
              <span className={asaasConn.status === "active" ? "badge ok" : "badge bad"}>
                {asaasConn.status}
              </span>
            </dd>
            {asaasConn.account_id ? (
              <>
                <dt>Conta</dt>
                <dd>
                  <code>{asaasConn.account_id}</code>
                </dd>
              </>
            ) : null}
            <dt>Atualizado</dt>
            <dd>{formatDate(asaasConn.updated_at)}</dd>
          </dl>
        ) : (
          <p>Nenhuma conta Asaas conectada.</p>
        )}
        <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
          <button type="button" disabled={busy} onClick={() => void onboardAsaas()}>
            <ExternalLink size={16} />
            Conectar Asaas
          </button>
          {asaasConn ? (
            <button type="button" disabled={busy} onClick={() => void syncAsaas()}>
              <RefreshCw size={16} />
              Sincronizar
            </button>
          ) : null}
        </div>
      </section>

      {/* Other connections */}
      {connections.filter((c) => c.provider !== "stripe" && c.provider !== "asaas").length > 0 ? (
        <section className="panel stacked">
          <div className="panel-title">
            <h2>Outras conexoes</h2>
            <Trash2 size={18} />
          </div>
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Provedor</th>
                  <th>Status</th>
                  <th>Conta</th>
                  <th>Criado</th>
                </tr>
              </thead>
              <tbody>
                {connections
                  .filter((c) => c.provider !== "stripe" && c.provider !== "asaas")
                  .map((conn) => (
                    <tr key={conn.id}>
                      <td>{conn.provider}</td>
                      <td>
                        <span className={conn.status === "active" ? "badge ok" : "badge bad"}>
                          {conn.status}
                        </span>
                      </td>
                      <td>
                        <code>{conn.account_id ?? "—"}</code>
                      </td>
                      <td>{formatDate(conn.created_at)}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
    </>
  );
}
