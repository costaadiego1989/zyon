import React, { useEffect, useMemo, useState } from "react";
import { CreditCard, ExternalLink, RefreshCw, Sparkles, CheckCircle2, Receipt, Activity, Zap, BarChart3 } from "lucide-react";
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
  incomplete: "Pendente",
  incomplete_expired: "Expirada",
  unpaid: "Pagamento pendente",
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
    priceId: "starter",
    price: "Gratuito",
    features: ["1 site conectado", "Até 500 conversas por mês", "Notificações em tempo real", "Suporte via comunidade"],
  },
  {
    key: "growth",
    name: "Growth",
    priceId: "growth",
    price: "R$ 299/mês",
    features: ["Até 5 sites conectados", "Até 10 mil conversas por mês", "Notificações com histórico", "Suporte por e-mail prioritário"],
    highlight: true,
  },
  {
    key: "scale",
    name: "Scale",
    priceId: "scale",
    price: "R$ 899/mês",
    features: ["Sites ilimitados", "Conversas ilimitadas", "Garantia de disponibilidade 99,9%", "Gerente de conta dedicado"],
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

  async function openCheckout(priceId: string) {
    setBusy(true);
    setMessage(null);
    try {
      const { url } = await api.createBillingCheckoutSession({
        price_id: priceId,
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
        <header className="page-head">
          <div>
            <p className="eyebrow">Plano &amp; Cobrança</p>
            <h1>Faturamento</h1>
            <p className="page-lead">Login necessário para ver assinatura e faturas.</p>
          </div>
        </header>
        <div className="panel panel-info">
          <p>Faça login para acessar informações de faturamento.</p>
        </div>
      </>
    );
  }

  return (
    <>
      <header className="page-head">
        <div>
          <p className="eyebrow">Plano &amp; Cobrança</p>
          <h1>Faturamento</h1>
          <p className="page-lead">Gerencie sua assinatura e acompanhe o uso da plataforma.</p>
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
            <button type="button" className="primary-action" disabled={busy} onClick={() => void openCheckout("starter")}>
              <CreditCard size={16} />
              Assinar plano
            </button>
          )}
        </div>
      </header>

      <div role="status" aria-live="polite">
        {message ? <p className="panel panel-warn">{message}</p> : null}
        {loading ? <p className="panel panel-info">Carregando...</p> : null}
      </div>

      <div className="metrics">
        <article className="metric">
          <BarChart3 size={18} aria-hidden />
          <span className="metric-value">{subscription?.plan ?? "—"}</span>
          <span className="metric-label">Plano Atual</span>
        </article>
        <article className="metric">
          <Activity size={18} aria-hidden />
          <span className="metric-value">{subscription?.usage?.sessions_current ?? "—"}</span>
          <span className="metric-label">Sessões este mês</span>
        </article>
        <article className="metric">
          <Zap size={18} aria-hidden />
          <span className="metric-value">{subscription?.usage?.installations_current ?? "—"}</span>
          <span className="metric-label">Instalações ativas</span>
        </article>
        <article className="metric">
          <CreditCard size={18} aria-hidden />
          <span className="metric-value">
            <span className={subscription ? statusBadgeClass(subscription.status) : "badge"}>
              {subscription ? (STATUS_LABEL[subscription.status] ?? subscription.status) : "Sem plano"}
            </span>
          </span>
          <span className="metric-label">Status</span>
        </article>
      </div>

      {subscription ? (
        <section className="panel stacked">
          <div className="panel-title">
            <h2>Assinatura atual</h2>
            <CreditCard size={18} />
          </div>
          <dl className="detail-list">
            <dt>Plano</dt>
            <dd>
              <strong className="plan-price" style={{ fontSize: 13 }}>{subscription.plan}</strong>
            </dd>
            <dt>Status</dt>
            <dd>
              <span className={statusBadgeClass(subscription.status)}>
                {STATUS_LABEL[subscription.status] ?? subscription.status}
              </span>
            </dd>
            <dt>Renovação</dt>
            <dd className="plan-price" style={{ fontSize: 13 }}>{formatDate(subscription.current_period_end)}</dd>
            {subscription.trial_end ? (
              <>
                <dt>Fim do teste</dt>
                <dd className="plan-price" style={{ fontSize: 13 }}>{formatDate(subscription.trial_end)}</dd>
              </>
            ) : null}
            {subscription.cancel_at_period_end ? (
              <>
                <dt>Cancelamento</dt>
                <dd><span className="badge warn">Agendado ao fim do período</span></dd>
              </>
            ) : null}
          </dl>
          {subscription.usage ? (
            <div className="metrics">
              <div className="metric">
                <span className="metric-label">Sessões este mês</span>
                <span className="metric-value">{subscription.usage.sessions_current ?? "—"}</span>
              </div>
              <div className="metric">
                <span className="metric-label">Instalações ativas</span>
                <span className="metric-value">{subscription.usage.installations_current ?? "—"}</span>
              </div>
            </div>
          ) : null}
        </section>
      ) : !loading ? (
        <div className="panel panel-warn">
          Você ainda não tem um plano ativo. Escolha o plano ideal para sua operação.
        </div>
      ) : null}

      <section className="panel stacked">
        <div className="panel-title">
          <h2>Histórico de faturas</h2>
          <Receipt size={18} />
        </div>
        <p className="empty-state">Nenhuma fatura encontrada. O histórico estará disponível em breve.</p>
      </section>

      <section className="panel stacked">
        <div className="panel-title">
          <h2>Método de pagamento</h2>
          <CreditCard size={18} />
        </div>
        <p className="empty-state">
          Nenhum método cadastrado.{" "}
          <button type="button" className="link-button" disabled={busy} onClick={() => void openPortal()}>
            Gerenciar assinatura
          </button>
        </p>
      </section>

      <div className="section-header">
        <h2>Planos disponíveis</h2>
        <p className="page-lead">Escolha o plano ideal para seu volume de vendas</p>
      </div>

      <div className="ops-grid three-col" style={{ alignItems: "stretch" }}>
        {PLANS.map((plan) => {
          const isCurrent = subscription?.plan?.toLowerCase() === plan.key;
          return (
            <section
              key={plan.key}
              className={`panel stacked${plan.highlight ? " plan-highlighted" : ""}`}
              aria-labelledby={`plan-${plan.key}-title`}
              style={{
                display: "flex",
                flexDirection: "column",
                ...(isCurrent ? { borderColor: "var(--color-ok)", borderWidth: 2, borderStyle: "solid" } : {}),
              }}
            >
              {plan.highlight ? (
                <div className="plan-badge-popular">
                  <Sparkles size={13} />
                  Recomendado
                </div>
              ) : null}
              <div className="panel-title">
                <h2 id={`plan-${plan.key}-title`}>{plan.name}</h2>
                {isCurrent ? (
                  <span className="badge ok" style={{ fontWeight: 600 }}>
                    <CheckCircle2 size={12} style={{ marginRight: 4 }} />
                    Seu plano atual
                  </span>
                ) : null}
              </div>
              <p className="plan-price">{plan.price}</p>
              <ul className="plan-features" aria-label={`Recursos do plano ${plan.name}`} style={{ flex: 1 }}>
                {plan.features.map((feat) => (
                  <li key={feat}>
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
                  onClick={() => void openCheckout(plan.priceId)}
                  aria-label={`Ativar plano ${plan.name}`}
                  style={{ width: "100%", justifyContent: "center", marginTop: "auto" }}
                >
                  {subscription ? "Fazer upgrade" : "Ativar plano"}
                </button>
              ) : (
                <button
                  type="button"
                  disabled
                  className="btn-secondary"
                  style={{ width: "100%", justifyContent: "center", marginTop: "auto", opacity: 0.6 }}
                >
                  <CheckCircle2 size={14} />
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
