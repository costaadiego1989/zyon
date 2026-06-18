import React, { useEffect, useMemo, useState } from "react";
import { CreditCard, ExternalLink, RefreshCw } from "lucide-react";
import {
  createDashboardApi,
  DashboardHttpError,
  type BillingSubscription,
  type MerchantProfile,
} from "../api-client.js";

function readError(e: unknown): string {
  return e instanceof DashboardHttpError
    ? e.responseBody.slice(0, 240) || `HTTP ${e.status}`
    : e instanceof Error
      ? e.message
      : String(e);
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short" }).format(new Date(iso));
}

const STATUS_LABEL: Record<string, string> = {
  active: "Ativa",
  trialing: "Em teste",
  past_due: "Em atraso",
  canceled: "Cancelada",
  incomplete: "Incompleta",
  incomplete_expired: "Expirada",
  unpaid: "Inadimplente",
};

export function BillingPage(props: { apiBaseUrl: string; me: MerchantProfile | null }) {
  const api = useMemo(() => createDashboardApi({ baseUrl: props.apiBaseUrl }), [props.apiBaseUrl]);
  const [subscription, setSubscription] = useState<BillingSubscription | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!props.me) {
      setSubscription(null);
      return;
    }
    void load();
  }, [props.me]); // eslint-disable-line react-hooks/exhaustive-deps

  async function load() {
    setLoading(true);
    setMessage(null);
    try {
      const sub = await api.getBillingSubscription();
      setSubscription(sub);
    } catch (e) {
      setMessage(readError(e));
    } finally {
      setLoading(false);
    }
  }

  async function openPortal() {
    setBusy(true);
    setMessage(null);
    try {
      const { url } = await api.createBillingPortalSession({
        return_url: window.location.href,
      });
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (e) {
      setMessage(readError(e));
    } finally {
      setBusy(false);
    }
  }

  async function openCheckout() {
    setBusy(true);
    setMessage(null);
    try {
      const { url } = await api.createBillingCheckoutSession({
        success_url: window.location.href,
        cancel_url: window.location.href,
      });
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (e) {
      setMessage(readError(e));
    } finally {
      setBusy(false);
    }
  }

  if (!props.me) {
    return (
      <>
        <h1>Faturamento</h1>
        <p className="page-lead">Login necessario para ver assinatura e faturas.</p>
      </>
    );
  }

  return (
    <>
      <header className="page-head">
        <div>
          <h1>Faturamento</h1>
          <p className="page-lead">Plano, assinatura e historico de cobranças do tenant.</p>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button type="button" disabled={loading || busy} onClick={() => void load()}>
            <RefreshCw size={16} />
            Atualizar
          </button>
          {subscription ? (
            <button type="button" disabled={busy} onClick={() => void openPortal()}>
              <ExternalLink size={16} />
              Portal de faturamento
            </button>
          ) : (
            <button type="button" disabled={busy} onClick={() => void openCheckout()}>
              <CreditCard size={16} />
              Assinar plano
            </button>
          )}
        </div>
      </header>

      {message ? <p className="panel panel-warn">{message}</p> : null}
      {loading ? <p className="panel panel-info">Carregando...</p> : null}

      {subscription ? (
        <section className="panel stacked">
          <div className="panel-title">
            <h2>Assinatura atual</h2>
            <CreditCard size={18} />
          </div>
          <dl className="detail-list">
            <dt>Plano</dt>
            <dd>{subscription.plan}</dd>
            <dt>Status</dt>
            <dd>
              <span
                className={
                  subscription.status === "active" || subscription.status === "trialing"
                    ? "badge ok"
                    : "badge bad"
                }
              >
                {STATUS_LABEL[subscription.status] ?? subscription.status}
              </span>
            </dd>
            <dt>Renovacao</dt>
            <dd>{formatDate(subscription.current_period_end)}</dd>
            {subscription.trial_end ? (
              <>
                <dt>Fim do teste</dt>
                <dd>{formatDate(subscription.trial_end)}</dd>
              </>
            ) : null}
            {subscription.cancel_at_period_end ? (
              <>
                <dt>Cancelamento</dt>
                <dd>Agendado ao fim do periodo</dd>
              </>
            ) : null}
          </dl>
        </section>
      ) : !loading ? (
        <section className="panel stacked">
          <p>Nenhuma assinatura ativa. Clique em <strong>Assinar plano</strong> para comecar.</p>
        </section>
      ) : null}
    </>
  );
}
