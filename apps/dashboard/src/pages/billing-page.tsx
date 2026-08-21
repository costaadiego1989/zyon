import React, { useEffect, useState } from "react";
import { CreditCard, Receipt, Activity, Zap, BarChart3 } from "lucide-react";
import { EmptyState } from "../components/EmptyState.js";
import {
  type BillingSubscription,
  type MerchantProfile,
} from "../api-client.js";
import { useBillingApi } from "../hooks/api/useBillingApi.js";
import { SectionHeader } from "../components/SectionHeader.js";
import { Button } from "../components/Button.js";
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
      <span style={{ display: "inline-flex", alignItems: "center", padding: "3px 10px", borderRadius: 999, font: "600 11px var(--font-mono)", background: "var(--surface-1)", color: "var(--color-text-muted)", border: "1px solid var(--color-border)" }}>Sem plano</span>
    );
  }
  if (status === "active" || status === "starter" || status === "trialing") {
    return (
      <span style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "3px 10px", borderRadius: 999, font: "600 11px var(--font-mono)", background: "var(--color-success-bg)", color: "var(--color-success)", border: "1px solid var(--color-success)" }}>
        <span style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--color-success)", flexShrink: 0 }} />
        {STATUS_LABEL[status] ?? status}
      </span>
    );
  }
  if (status === "past_due" || status === "unpaid") {
    return (
      <span style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "3px 10px", borderRadius: 999, font: "600 11px var(--font-mono)", background: "var(--color-warning-bg)", color: "var(--color-warning)", border: "1px solid var(--color-warning)" }}>
        <span style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--color-warning)", flexShrink: 0 }} />
        {STATUS_LABEL[status] ?? status}
      </span>
    );
  }
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "3px 10px", borderRadius: 999, font: "600 11px var(--font-mono)", background: "var(--color-error-bg)", color: "var(--color-error)", border: "1px solid var(--color-error)" }}>
      <span style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--color-error)", flexShrink: 0 }} />
      {STATUS_LABEL[status] ?? status}
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
    <div style={{ background: "var(--surface-1)", border: "1px solid var(--color-border)", borderRadius: 10, padding: "12px 14px", display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "baseline" }}>
        <span style={{ font: "600 10px var(--font-mono)", letterSpacing: "0.06em", color: "var(--color-text-faint)", textTransform: "uppercase" }}>{props.label}</span>
        <span style={{ font: "600 12px var(--font-mono)", color: "var(--color-text)" }}>{formatLimit(props.current)} / {formatLimit(props.limit)}</span>
      </div>
      {props.limit === null ? (
        <span style={{ font: "12px var(--font-sans)", color: "var(--color-text-muted)" }}>Uso ilimitado neste plano</span>
      ) : (
        <div aria-hidden="true" style={{ height: 8, borderRadius: 999, background: "var(--color-border)", overflow: "hidden" }}>
          <div style={{ height: "100%", width: `${percent}%`, borderRadius: 999, background: percent >= 90 ? "var(--color-warning)" : "var(--color-brand)" }} />
        </div>
      )}
    </div>
  );
}


export function BillingPage(props: { apiBaseUrl: string; me: MerchantProfile | null }) {
  const billing = useBillingApi();
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
      const sub = await billing.getBillingSubscription();
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
      const { url } = await billing.createBillingPortalSession({
        return_url: window.location.href,
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
            <span className="eyebrow">Conta</span>
            <h1>Faturamento</h1>
            <p className="page-lead">Login necessário para ver assinatura e faturas</p>
          </div>
        </header>
        <div style={{ background: "var(--color-brand-subtle)", border: "1px solid var(--color-brand-ring)", borderRadius: 14, padding: "14px 18px", color: "var(--color-brand)", font: "13px var(--font-sans)" }}>
          <p style={{ margin: 0 }}>Faça login para acessar informações de faturamento.</p>
        </div>
      </>
    );
  }

  return (
    <>
      <header className="page-head">
        <div>
          <span className="eyebrow">Conta</span>
          <h1>Faturamento</h1>
          <p className="page-lead">Gerencie sua assinatura e acompanhe o uso da plataforma</p>
        </div>
      </header>

      <div role="status" aria-live="polite">
        {message ? (
          <div style={{ background: "var(--color-warning-bg)", border: "1px solid var(--color-warning)", borderRadius: 14, padding: "14px 18px", marginBottom: 20, color: "var(--color-warning)", font: "13px var(--font-sans)" }}>
            <p style={{ margin: 0 }}>{message}</p>
          </div>
        ) : null}
        {loading ? (
          <div style={{ background: "var(--color-brand-subtle)", border: "1px solid var(--color-brand-ring)", borderRadius: 14, padding: "14px 18px", marginBottom: 20, color: "var(--color-brand)", font: "13px var(--font-sans)" }}>
            <p style={{ margin: 0 }}>Carregando...</p>
          </div>
        ) : null}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 16, marginBottom: 20 }}>
        <article style={{ background: "var(--surface-2)", border: "1px solid var(--color-border)", borderRadius: 14, padding: 20, display: "flex", flexDirection: "column", gap: 8 }}>
          <BarChart3 size={18} aria-hidden="true" style={{ color: "var(--color-brand)" }} />
          <span style={{ font: "700 24px var(--font-serif)", color: "var(--color-text)" }}>{subscription?.plan_name ?? subscription?.plan ?? "—"}</span>
          <span style={{ font: "600 10px var(--font-mono)", letterSpacing: "0.06em", color: "var(--color-text-faint)", textTransform: "uppercase" }}>Plano Atual</span>
        </article>
        <article style={{ background: "var(--surface-2)", border: "1px solid var(--color-border)", borderRadius: 14, padding: 20, display: "flex", flexDirection: "column", gap: 8 }}>
          <Activity size={18} aria-hidden="true" style={{ color: "var(--color-brand)" }} />
          <span style={{ font: "700 24px var(--font-serif)", color: "var(--color-text)" }}>{subscription?.usage?.sessions_current ?? "—"}</span>
          <span style={{ font: "600 10px var(--font-mono)", letterSpacing: "0.06em", color: "var(--color-text-faint)", textTransform: "uppercase" }}>Sessões este mês</span>
        </article>
        <article style={{ background: "var(--surface-2)", border: "1px solid var(--color-border)", borderRadius: 14, padding: 20, display: "flex", flexDirection: "column", gap: 8 }}>
          <Zap size={18} aria-hidden="true" style={{ color: "var(--color-brand)" }} />
          <span style={{ font: "700 24px var(--font-serif)", color: "var(--color-text)" }}>{subscription?.usage?.ai_conversations_current ?? "—"}</span>
          <span style={{ font: "600 10px var(--font-mono)", letterSpacing: "0.06em", color: "var(--color-text-faint)", textTransform: "uppercase" }}>Conversas IA este mês</span>
        </article>
        <article style={{ background: "var(--surface-2)", border: "1px solid var(--color-border)", borderRadius: 14, padding: 20, display: "flex", flexDirection: "column", gap: 8 }}>
          <CreditCard size={18} aria-hidden="true" style={{ color: "var(--color-brand)" }} />
          <div>{subscriptionStatusBadge(subscription?.status)}</div>
          <span style={{ font: "600 10px var(--font-mono)", letterSpacing: "0.06em", color: "var(--color-text-faint)", textTransform: "uppercase" }}>Status</span>
        </article>
      </div>

      {subscription ? (
        <section style={{ background: "var(--surface-2)", border: "1px solid var(--color-border)", borderRadius: 14, padding: 22, marginBottom: 20, display: "flex", flexDirection: "column", gap: 16 }} aria-label="Assinatura atual">
          <SectionHeader title="Assinatura atual" variant="secondary" />
          <dl style={{ display: "grid", gridTemplateColumns: "160px 1fr", rowGap: 10, columnGap: 16, margin: 0 }}>
            <dt style={{ font: "600 10px var(--font-mono)", letterSpacing: "0.06em", color: "var(--color-text-faint)", textTransform: "uppercase" }}>Plano</dt>
            <dd style={{ margin: 0, font: "600 13px var(--font-mono)", color: "var(--color-text)" }}>{subscription.plan_name ?? subscription.plan}</dd>
            <dt style={{ font: "600 10px var(--font-mono)", letterSpacing: "0.06em", color: "var(--color-text-faint)", textTransform: "uppercase" }}>Fee Zyon</dt>
            <dd style={{ margin: 0, font: "600 13px var(--font-mono)", color: "var(--color-text)" }}>{subscription.transaction_fee_percent?.toLocaleString("pt-BR") ?? "—"}% por transação</dd>
            <dt style={{ font: "600 10px var(--font-mono)", letterSpacing: "0.06em", color: "var(--color-text-faint)", textTransform: "uppercase" }}>Status</dt>
            <dd style={{ margin: 0 }}>{subscriptionStatusBadge(subscription.status)}</dd>
            <dt style={{ font: "600 10px var(--font-mono)", letterSpacing: "0.06em", color: "var(--color-text-faint)", textTransform: "uppercase" }}>Renovação</dt>
            <dd style={{ margin: 0, font: "600 13px var(--font-mono)", color: "var(--color-text)" }}>{formatDate(subscription.current_period_end)}</dd>
            {subscription.trial_end ? (
              <>
                <dt style={{ font: "600 10px var(--font-mono)", letterSpacing: "0.06em", color: "var(--color-text-faint)", textTransform: "uppercase" }}>Fim do teste</dt>
                <dd style={{ margin: 0, font: "600 13px var(--font-mono)", color: "var(--color-text)" }}>{formatDate(subscription.trial_end)}</dd>
              </>
            ) : null}
            {subscription.cancel_at_period_end ? (
              <>
                <dt style={{ font: "600 10px var(--font-mono)", letterSpacing: "0.06em", color: "var(--color-text-faint)", textTransform: "uppercase" }}>Cancelamento</dt>
                <dd style={{ margin: 0 }}>
                  <span style={{ display: "inline-flex", alignItems: "center", padding: "3px 10px", borderRadius: 999, font: "600 11px var(--font-mono)", background: "var(--color-warning-bg)", color: "var(--color-warning)", border: "1px solid var(--color-warning)" }}>Agendado ao fim do período</span>
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
        <div style={{ background: "var(--color-warning-bg)", border: "1px solid var(--color-warning)", borderRadius: 14, padding: "14px 18px", color: "var(--color-warning)", font: "13px var(--font-sans)" }}>
          Você ainda não tem um plano ativo. Escolha o plano ideal para sua operação.
        </div>
      ) : null}

      <section style={{ background: "var(--surface-2)", border: "1px solid var(--color-border)", borderRadius: 14, padding: 22, marginBottom: 20, display: "flex", flexDirection: "column", gap: 16 }} aria-label="Histórico de faturas">
        <SectionHeader title="Histórico de faturas" variant="secondary" />
        <EmptyState icon={Receipt} title="Nenhuma fatura encontrada" description="O histórico estará disponível em breve." />
      </section>

      <section style={{ background: "var(--surface-2)", border: "1px solid var(--color-border)", borderRadius: 14, padding: 22, marginBottom: 20, display: "flex", flexDirection: "column", gap: 16 }} aria-label="Método de pagamento">
        <SectionHeader title="Método de pagamento" variant="secondary" />
        <EmptyState
          icon={CreditCard}
          title="Nenhum método cadastrado"
          action={
            <Button variant="outline" size="md" disabled={busy} loading={busy} onClick={() => void openPortal()}>
              Gerenciar assinatura
            </Button>
          }
        />
      </section>

    </>
  );
}
