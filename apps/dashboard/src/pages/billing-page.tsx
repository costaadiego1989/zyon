import React, { useEffect, useState } from "react";
import { CreditCard, ExternalLink, RefreshCw, Sparkles, CheckCircle2, Receipt, Activity, Zap, BarChart3 } from "lucide-react";
import {
  type BillingSubscription,
  type MerchantProfile,
} from "../api-client.js";
import { useApi } from "../hooks/useApi.js";
import { readError } from "../utils/read-error.js";

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short" }).format(new Date(iso));
}

const STATUS_LABEL: Record<string, string> = {
  active: "Ativa",
  starter: "Starter",
  trialing: "Em teste",
  past_due: "Em atraso",
  canceled: "Cancelada",
  cancelled: "Cancelada",
  incomplete: "Pendente",
  incomplete_expired: "Expirada",
  unpaid: "Pagamento pendente",
};

function statusBadgeClass(status: string): string {
  if (status === "active" || status === "starter" || status === "trialing") return "badge ok";
  if (status === "past_due" || status === "unpaid") return "badge warn";
  return "badge bad";
}

function subscriptionStatusBadge(status: string | undefined) {
  if (!status) {
    return (
      <span style={{ display: "inline-flex", alignItems: "center", padding: "3px 10px", borderRadius: 999, font: "600 11px var(--mono)", background: "var(--bg)", color: "var(--muted)", border: "1px solid var(--border)" }}>Sem plano</span>
    );
  }
  if (status === "active" || status === "starter" || status === "trialing") {
    return (
      <span style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "3px 10px", borderRadius: 999, font: "600 11px var(--mono)", background: "var(--good-soft)", color: "var(--good)", border: "1px solid var(--good)" }}>
        <span style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--good)", flexShrink: 0 }} />
        {STATUS_LABEL[status] ?? status}
      </span>
    );
  }
  if (status === "past_due" || status === "unpaid") {
    return (
      <span style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "3px 10px", borderRadius: 999, font: "600 11px var(--mono)", background: "var(--warn-soft)", color: "var(--warn)", border: "1px solid var(--warn)" }}>
        <span style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--warn)", flexShrink: 0 }} />
        {STATUS_LABEL[status] ?? status}
      </span>
    );
  }
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "3px 10px", borderRadius: 999, font: "600 11px var(--mono)", background: "var(--danger-soft)", color: "var(--danger)", border: "1px solid var(--danger)" }}>
      <span style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--danger)", flexShrink: 0 }} />
      {STATUS_LABEL[status] ?? status}
    </span>
  );
}

function planBadge() {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "3px 10px", borderRadius: 999, font: "600 11px var(--mono)", background: "var(--good-soft)", color: "var(--good)", border: "1px solid var(--good)", fontWeight: 600 }}>
      <CheckCircle2 size={12} />
      Seu plano atual
    </span>
  );
}

function formatLimit(limit: number | null | undefined): string {
  return limit === null ? "Ilimitado" : typeof limit === "number" ? new Intl.NumberFormat("pt-BR").format(limit) : "—";
}

function usagePercent(current: number | null | undefined, limit: number | null | undefined): number {
  if (!limit || current === null || current === undefined) return 0;
  return Math.min(100, Math.round((current / limit) * 100));
}

function UsageBar(props: { label: string; current?: number | null; limit?: number | null }) {
  const percent = usagePercent(props.current, props.limit);
  return (
    <div style={{ background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 10, padding: "12px 14px", display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "baseline" }}>
        <span style={{ font: "600 10px var(--mono)", letterSpacing: "0.06em", color: "var(--faint)", textTransform: "uppercase" }}>{props.label}</span>
        <span style={{ font: "600 12px var(--mono)", color: "var(--ink)" }}>{formatLimit(props.current)} / {formatLimit(props.limit)}</span>
      </div>
      {props.limit === null ? (
        <span style={{ font: "12px var(--sans)", color: "var(--muted)" }}>Uso ilimitado neste plano</span>
      ) : (
        <div aria-hidden="true" style={{ height: 8, borderRadius: 999, background: "var(--border)", overflow: "hidden" }}>
          <div style={{ height: "100%", width: `${percent}%`, borderRadius: 999, background: percent >= 90 ? "var(--warn)" : "var(--accent)" }} />
        </div>
      )}
    </div>
  );
}

const PLANS = [
  {
    key: "starter",
    name: "Starter",
    priceId: "starter",
    price: "R$ 89/mês",
    fee: "1,99% por transação",
    features: ["50 pedidos/mês", "50 sessões/mês", "100 conversas IA/mês", "1 conexão commerce", "Webhooks ilimitados", "1 cross-sell", "1 cupom ativo", "Tema e agente customizados", "Sem marca d’água"],
  },
  {
    key: "growth",
    name: "Growth",
    priceId: "growth",
    price: "R$ 199/mês",
    fee: "1,49% por transação",
    features: ["500 pedidos/mês", "1.000 sessões/mês", "5.000 conversas IA/mês", "2 conexões commerce", "Webhooks ilimitados", "10 cross-sells", "10 cupons ativos", "Tema e agente customizados", "Voice checkout", "Face biometry", "Crypto payments"],
    highlight: true,
  },
  {
    key: "scale",
    name: "Scale",
    priceId: "scale",
    price: "R$ 499/mês",
    fee: "0,99% por transação",
    features: ["Pedidos ilimitados", "Sessões ilimitadas", "Conversas IA ilimitadas", "Conexões commerce ilimitadas", "Webhooks ilimitados", "10 membros", "Cross-sell ilimitado", "Cupons ilimitados", "Face biometry", "Crypto payments", "White-label"],
  },
];

export function BillingPage(props: { apiBaseUrl: string; me: MerchantProfile | null }) {
  const api = useApi();
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
        <div style={{ marginBottom: 20 }}>
          <div style={{ font: "600 10px var(--mono)", letterSpacing: "0.06em", color: "var(--faint)", marginBottom: 4 }}>CONTA</div>
          <h1 style={{ font: "700 22px var(--serif)", color: "var(--ink)", letterSpacing: "-0.02em", marginBottom: 6 }}>Faturamento</h1>
          <div style={{ font: "17px var(--serif)", fontStyle: "italic", color: "var(--muted)" }}>Login necessário para ver assinatura e faturas.</div>
        </div>
        <div style={{ background: "var(--accent-soft)", border: "1px solid var(--accent-line)", borderRadius: 14, padding: "14px 18px", color: "var(--accent)", font: "13px var(--sans)" }}>
          <p style={{ margin: 0 }}>Faça login para acessar informações de faturamento.</p>
        </div>
      </>
    );
  }

  return (
    <>
      <div style={{ marginBottom: 20, display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
        <div>
          <div style={{ font: "600 10px var(--mono)", letterSpacing: "0.06em", color: "var(--faint)", marginBottom: 4 }}>CONTA</div>
          <h1 style={{ font: "700 22px var(--serif)", color: "var(--ink)", letterSpacing: "-0.02em", marginBottom: 6 }}>Faturamento</h1>
          <div style={{ font: "17px var(--serif)", fontStyle: "italic", color: "var(--muted)" }}>Gerencie sua assinatura e acompanhe o uso da plataforma.</div>
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <button
            type="button"
            style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "10px 16px", borderRadius: 10, border: "1px solid var(--border)", background: "transparent", color: "var(--ink)", font: "600 13px var(--mono)", cursor: loading || busy ? "not-allowed" : "pointer", opacity: loading || busy ? 0.5 : 1 }}
            disabled={loading || busy}
            onClick={() => void load()}
          >
            <RefreshCw size={16} aria-hidden="true" />
            Atualizar
          </button>
          {subscription ? (
            <button
              type="button"
              style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "10px 16px", borderRadius: 10, border: "none", background: "linear-gradient(180deg, var(--accent), var(--accent-dark))", color: "var(--bg)", font: "600 13px var(--mono)", cursor: busy ? "not-allowed" : "pointer", opacity: busy ? 0.6 : 1 }}
              disabled={busy}
              onClick={() => void openPortal()}
            >
              <ExternalLink size={16} aria-hidden="true" />
              Portal de faturamento
            </button>
          ) : (
            <button
              type="button"
              style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "10px 16px", borderRadius: 10, border: "none", background: "linear-gradient(180deg, var(--accent), var(--accent-dark))", color: "var(--bg)", font: "600 13px var(--mono)", cursor: busy ? "not-allowed" : "pointer", opacity: busy ? 0.6 : 1 }}
              disabled={busy}
              onClick={() => void openCheckout("starter")}
            >
              <CreditCard size={16} aria-hidden="true" />
              Assinar plano
            </button>
          )}
        </div>
      </div>

      <div role="status" aria-live="polite">
        {message ? (
          <div style={{ background: "var(--warn-soft)", border: "1px solid var(--warn)", borderRadius: 14, padding: "14px 18px", marginBottom: 20, color: "var(--warn)", font: "13px var(--sans)" }}>
            <p style={{ margin: 0 }}>{message}</p>
          </div>
        ) : null}
        {loading ? (
          <div style={{ background: "var(--accent-soft)", border: "1px solid var(--accent-line)", borderRadius: 14, padding: "14px 18px", marginBottom: 20, color: "var(--accent)", font: "13px var(--sans)" }}>
            <p style={{ margin: 0 }}>Carregando...</p>
          </div>
        ) : null}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 16, marginBottom: 20 }}>
        <article style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 14, padding: 20, display: "flex", flexDirection: "column", gap: 8 }}>
          <BarChart3 size={18} aria-hidden="true" style={{ color: "var(--accent)" }} />
          <span style={{ font: "700 24px var(--serif)", color: "var(--ink)" }}>{subscription?.plan_name ?? subscription?.plan ?? "—"}</span>
          <span style={{ font: "600 10px var(--mono)", letterSpacing: "0.06em", color: "var(--faint)", textTransform: "uppercase" }}>Plano Atual</span>
        </article>
        <article style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 14, padding: 20, display: "flex", flexDirection: "column", gap: 8 }}>
          <Activity size={18} aria-hidden="true" style={{ color: "var(--accent)" }} />
          <span style={{ font: "700 24px var(--serif)", color: "var(--ink)" }}>{subscription?.usage?.sessions_current ?? "—"}</span>
          <span style={{ font: "600 10px var(--mono)", letterSpacing: "0.06em", color: "var(--faint)", textTransform: "uppercase" }}>Sessões este mês</span>
        </article>
        <article style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 14, padding: 20, display: "flex", flexDirection: "column", gap: 8 }}>
          <Zap size={18} aria-hidden="true" style={{ color: "var(--accent)" }} />
          <span style={{ font: "700 24px var(--serif)", color: "var(--ink)" }}>{subscription?.usage?.ai_conversations_current ?? "—"}</span>
          <span style={{ font: "600 10px var(--mono)", letterSpacing: "0.06em", color: "var(--faint)", textTransform: "uppercase" }}>Conversas IA este mês</span>
        </article>
        <article style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 14, padding: 20, display: "flex", flexDirection: "column", gap: 8 }}>
          <CreditCard size={18} aria-hidden="true" style={{ color: "var(--accent)" }} />
          <div>{subscriptionStatusBadge(subscription?.status)}</div>
          <span style={{ font: "600 10px var(--mono)", letterSpacing: "0.06em", color: "var(--faint)", textTransform: "uppercase" }}>Status</span>
        </article>
      </div>

      {subscription ? (
        <section style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 14, padding: 22, marginBottom: 20, display: "flex", flexDirection: "column", gap: 16 }} aria-label="Assinatura atual">
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <CreditCard size={18} aria-hidden="true" style={{ color: "var(--accent)" }} />
            <h2 style={{ font: "600 14px var(--mono)", color: "var(--ink)", margin: 0 }}>Assinatura atual</h2>
          </div>
          <dl style={{ display: "grid", gridTemplateColumns: "160px 1fr", rowGap: 10, columnGap: 16, margin: 0 }}>
            <dt style={{ font: "600 10px var(--mono)", letterSpacing: "0.06em", color: "var(--faint)", textTransform: "uppercase" }}>Plano</dt>
            <dd style={{ margin: 0, font: "600 13px var(--mono)", color: "var(--ink)" }}>{subscription.plan_name ?? subscription.plan}</dd>
            <dt style={{ font: "600 10px var(--mono)", letterSpacing: "0.06em", color: "var(--faint)", textTransform: "uppercase" }}>Fee Zyon</dt>
            <dd style={{ margin: 0, font: "600 13px var(--mono)", color: "var(--ink)" }}>{subscription.transaction_fee_percent?.toLocaleString("pt-BR") ?? "—"}% por transação</dd>
            <dt style={{ font: "600 10px var(--mono)", letterSpacing: "0.06em", color: "var(--faint)", textTransform: "uppercase" }}>Status</dt>
            <dd style={{ margin: 0 }}>{subscriptionStatusBadge(subscription.status)}</dd>
            <dt style={{ font: "600 10px var(--mono)", letterSpacing: "0.06em", color: "var(--faint)", textTransform: "uppercase" }}>Renovação</dt>
            <dd style={{ margin: 0, font: "600 13px var(--mono)", color: "var(--ink)" }}>{formatDate(subscription.current_period_end)}</dd>
            {subscription.trial_end ? (
              <>
                <dt style={{ font: "600 10px var(--mono)", letterSpacing: "0.06em", color: "var(--faint)", textTransform: "uppercase" }}>Fim do teste</dt>
                <dd style={{ margin: 0, font: "600 13px var(--mono)", color: "var(--ink)" }}>{formatDate(subscription.trial_end)}</dd>
              </>
            ) : null}
            {subscription.cancel_at_period_end ? (
              <>
                <dt style={{ font: "600 10px var(--mono)", letterSpacing: "0.06em", color: "var(--faint)", textTransform: "uppercase" }}>Cancelamento</dt>
                <dd style={{ margin: 0 }}>
                  <span style={{ display: "inline-flex", alignItems: "center", padding: "3px 10px", borderRadius: 999, font: "600 11px var(--mono)", background: "var(--warn-soft)", color: "var(--warn)", border: "1px solid var(--warn)" }}>Agendado ao fim do período</span>
                </dd>
              </>
            ) : null}
          </dl>
          {subscription.usage ? (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12 }}>
              <UsageBar label="Pedidos" current={subscription.usage.orders_current} limit={subscription.usage.orders_limit} />
              <UsageBar label="Sessões" current={subscription.usage.sessions_current} limit={subscription.usage.sessions_limit} />
              <UsageBar label="Conversas IA" current={subscription.usage.ai_conversations_current} limit={subscription.usage.ai_conversations_limit} />
              <UsageBar label="Conexões commerce" current={subscription.usage.commerce_connections_current} limit={subscription.usage.commerce_connections_limit} />
              <UsageBar label="Webhooks" current={subscription.usage.webhook_endpoints_current} limit={subscription.usage.webhook_endpoints_limit} />
              <UsageBar label="Cupons ativos" current={subscription.usage.active_coupons_current} limit={subscription.usage.active_coupons_limit} />
            </div>
          ) : null}
        </section>
      ) : !loading ? (
        <div style={{ background: "var(--warn-soft)", border: "1px solid var(--warn)", borderRadius: 14, padding: "14px 18px", color: "var(--warn)", font: "13px var(--sans)" }}>
          Você ainda não tem um plano ativo. Escolha o plano ideal para sua operação.
        </div>
      ) : null}

      <section style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 14, padding: 22, marginBottom: 20, display: "flex", flexDirection: "column", gap: 16 }} aria-label="Histórico de faturas">
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <Receipt size={18} aria-hidden="true" style={{ color: "var(--accent)" }} />
          <h2 style={{ font: "600 14px var(--mono)", color: "var(--ink)", margin: 0 }}>Histórico de faturas</h2>
        </div>
        <p style={{ margin: 0, font: "13px var(--sans)", color: "var(--muted)" }}>Nenhuma fatura encontrada. O histórico estará disponível em breve.</p>
      </section>

      <section style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 14, padding: 22, marginBottom: 20, display: "flex", flexDirection: "column", gap: 16 }} aria-label="Método de pagamento">
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <CreditCard size={18} aria-hidden="true" style={{ color: "var(--accent)" }} />
          <h2 style={{ font: "600 14px var(--mono)", color: "var(--ink)", margin: 0 }}>Método de pagamento</h2>
        </div>
        <p style={{ margin: 0, font: "13px var(--sans)", color: "var(--muted)" }}>
          Nenhum método cadastrado.{" "}
          <button type="button" style={{ background: "transparent", border: "none", padding: 0, color: "var(--accent)", font: "600 13px var(--mono)", cursor: busy ? "not-allowed" : "pointer", opacity: busy ? 0.6 : 1, textDecoration: "underline" }} disabled={busy} onClick={() => void openPortal()}>
            Gerenciar assinatura
          </button>
        </p>
      </section>

      <div style={{ margin: "8px 0 16px 0" }}>
        <h2 style={{ font: "600 16px var(--mono)", color: "var(--ink)", margin: 0 }}>Planos disponíveis</h2>
        <div style={{ font: "15px var(--serif)", fontStyle: "italic", color: "var(--muted)", marginTop: 4 }}>Escolha o plano ideal para seu volume de vendas</div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 20 }}>
        {PLANS.map((plan) => {
          const isCurrent = subscription?.plan?.toLowerCase() === plan.key;
          return (
            <section
              key={plan.key}
              aria-labelledby={`plan-${plan.key}-title`}
              style={{
                background: "var(--card)",
                border: `${isCurrent ? 2 : 1}px solid ${isCurrent ? "var(--good)" : "var(--border)"}`,
                borderRadius: 14,
                padding: 22,
                display: "flex",
                flexDirection: "column",
                gap: 14,
                position: "relative",
              }}
            >
              {plan.highlight ? (
                <div style={{ position: "absolute", top: -10, right: 14, display: "inline-flex", alignItems: "center", gap: 6, padding: "3px 10px", borderRadius: 999, font: "600 11px var(--mono)", background: "var(--accent-soft)", color: "var(--accent)", border: "1px solid var(--accent-line)" }}>
                  <Sparkles size={13} aria-hidden="true" />
                  Recomendado
                </div>
              ) : null}
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
                <h2 id={`plan-${plan.key}-title`} style={{ font: "700 20px var(--serif)", color: "var(--ink)", margin: 0 }}>{plan.name}</h2>
                {isCurrent ? planBadge() : null}
              </div>
              <div>
                <p style={{ margin: 0, font: "700 24px var(--serif)", color: "var(--ink)" }}>{plan.price}</p>
                <p style={{ margin: "4px 0 0", font: "600 12px var(--mono)", color: "var(--accent)" }}>{plan.fee}</p>
              </div>
              <ul aria-label={`Recursos do plano ${plan.name}`} style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 8, flex: 1, font: "13px var(--sans)", color: "var(--muted)" }}>
                {plan.features.map((feat) => (
                  <li key={feat} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <CheckCircle2 size={14} aria-hidden="true" style={{ color: "var(--accent)", flexShrink: 0 }} />
                    <span style={{ color: "var(--ink)" }}>{feat}</span>
                  </li>
                ))}
              </ul>
              {!isCurrent ? (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void openCheckout(plan.priceId)}
                  aria-label={`Ativar plano ${plan.name}`}
                  style={plan.highlight
                    ? { display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 8, width: "100%", padding: "10px 16px", borderRadius: 10, border: "none", background: "linear-gradient(180deg, var(--accent), var(--accent-dark))", color: "var(--bg)", font: "600 13px var(--mono)", cursor: busy ? "not-allowed" : "pointer", opacity: busy ? 0.6 : 1 }
                    : { display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 8, width: "100%", padding: "10px 16px", borderRadius: 10, border: "1px solid var(--border)", background: "transparent", color: "var(--ink)", font: "600 13px var(--mono)", cursor: busy ? "not-allowed" : "pointer", opacity: busy ? 0.6 : 1 }
                  }
                >
                  {subscription ? "Fazer upgrade" : "Ativar plano"}
                </button>
              ) : (
                <button
                  type="button"
                  disabled
                  style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 8, width: "100%", padding: "10px 16px", borderRadius: 10, border: "1px solid var(--border)", background: "transparent", color: "var(--muted)", font: "600 13px var(--mono)", opacity: 0.6 }}
                >
                  <CheckCircle2 size={14} aria-hidden="true" />
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
