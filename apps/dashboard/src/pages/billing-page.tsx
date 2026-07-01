import React, { useEffect, useMemo, useState } from "react";
import { CreditCard, ExternalLink, RefreshCw, Sparkles, CheckCircle2 } from "lucide-react";
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

function statusBadgeClass(status: string): string {
  if (status === "active" || status === "trialing") return "badge ok";
  if (status === "past_due" || status === "unpaid") return "badge warn";
  return "badge bad";
}

const PLANS = [
  {
    key: "starter",
    name: "Starter",
    price: "Gratuito",
    features: ["1 instalacao", "500 sessoes/mes", "Webhooks basicos", "Suporte comunidade"],
  },
  {
    key: "growth",
    name: "Growth",
    price: "R$ 299/mo",
    features: ["5 instalacoes", "10k sessoes/mes", "Webhooks + replay", "Suporte email"],
    highlight: true,
  },
  {
    key: "scale",
    name: "Scale",
    price: "R$ 899/mo",
    features: ["Instalacoes ilimitadas", "Sessoes ilimitadas", "SLA 99.9%", "Suporte dedicado"],
  },
];

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
          <p className="eyebrow">Plano &amp; Cobrança</p>
          <h1>Faturamento</h1>
          <p className="page-lead">Plano, assinatura e historico de cobranças do tenant.</p>
        </div>
        <div className="button-row">
          <button type="button" disabled={loading || busy} onClick={() => void load()}>
            <RefreshCw size={16} />
            Atualizar
          </button>
          {subscription ? (
            <button type="button" className="primary-action" disabled={busy} onClick={() => void openPortal()}>
              <ExternalLink size={16} />
              Portal de faturamento
            </button>
          ) : (
            <button type="button" className="primary-action" disabled={busy} onClick={() => void openCheckout()}>
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
            <dd>
              <strong style={{ fontFamily: "var(--font-data)", fontSize: 13 }}>{subscription.plan}</strong>
            </dd>
            <dt>Status</dt>
            <dd>
              <span className={statusBadgeClass(subscription.status)}>
                {STATUS_LABEL[subscription.status] ?? subscription.status}
              </span>
            </dd>
            <dt>Renovacao</dt>
            <dd style={{ fontFamily: "var(--font-data)", fontSize: 13 }}>{formatDate(subscription.current_period_end)}</dd>
            {subscription.trial_end ? (
              <>
                <dt>Fim do teste</dt>
                <dd style={{ fontFamily: "var(--font-data)", fontSize: 13 }}>{formatDate(subscription.trial_end)}</dd>
              </>
            ) : null}
            {subscription.cancel_at_period_end ? (
              <>
                <dt>Cancelamento</dt>
                <dd><span className="badge warn">Agendado ao fim do periodo</span></dd>
              </>
            ) : null}
          </dl>
        </section>
      ) : !loading ? (
        <div className="panel panel-warn" style={{ marginBottom: 24 }}>
          Nenhuma assinatura ativa. Selecione um plano abaixo para comecar.
        </div>
      ) : null}

      <div className="section-header">
        <h2>Planos disponíveis</h2>
        <p className="page-lead">Escolha o plano ideal para o volume do seu tenant.</p>
      </div>

      <div className="ops-grid" style={{ gridTemplateColumns: "repeat(3, 1fr)" }}>
        {PLANS.map((plan) => {
          const isCurrent = subscription?.plan?.toLowerCase() === plan.key;
          return (
            <section
              key={plan.key}
              className="panel stacked"
              style={plan.highlight ? { border: "1.5px solid var(--color-brand)", boxShadow: "0 0 0 3px var(--color-brand-subtle)" } : undefined}
            >
              {plan.highlight ? (
                <div style={{ display: "flex", alignItems: "center", gap: 6, color: "var(--color-brand)", fontWeight: 700, fontSize: 11, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 8 }}>
                  <Sparkles size={13} />
                  Mais popular
                </div>
              ) : null}
              <div className="panel-title" style={{ marginBottom: 4 }}>
                <h2>{plan.name}</h2>
                {isCurrent ? <span className="badge ok">Plano atual</span> : null}
              </div>
              <p style={{ fontFamily: "var(--font-data)", fontSize: 20, fontWeight: 700, color: "var(--color-text)", marginBottom: 16 }}>
                {plan.price}
              </p>
              <ul style={{ listStyle: "none", padding: 0, margin: "0 0 20px", display: "flex", flexDirection: "column", gap: 8 }}>
                {plan.features.map((feat) => (
                  <li key={feat} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "var(--color-text-secondary)" }}>
                    <CheckCircle2 size={14} style={{ color: "var(--color-brand)", flexShrink: 0 }} />
                    {feat}
                  </li>
                ))}
              </ul>
              {!isCurrent ? (
                <button
                  type="button"
                  className={plan.highlight ? "primary-action" : ""}
                  disabled={busy}
                  onClick={() => void openCheckout()}
                  style={{ width: "100%", justifyContent: "center" }}
                >
                  {subscription ? "Mudar para este plano" : "Assinar"}
                </button>
              ) : (
                <button type="button" disabled style={{ width: "100%", justifyContent: "center" }}>
                  Plano atual
                </button>
              )}
            </section>
          );
        })}
      </div>
    </>
  );
}
