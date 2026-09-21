import { BillingCycleSelector } from "./components/BillingCycleSelector.js";
import { billingMoney, selectedBillingOffer } from "./plan-catalog.js";
import React from "react";
import { useBillingPlansPage } from "./useBillingPlansPage.js";
import { CurrentPlanCard } from "./components/CurrentPlanCard.js";
import { UsageMeters, type UsageMeter } from "./components/UsageMeters.js";
import { PlanCard } from "./components/PlanCard.js";
import "./billing-plans-page.css";



const PLAN_ORDER = ["starter", "growth", "scale"] as const;

function getPlanIndex(plan: string | null): number {
  if (!plan) return -1;
  return PLAN_ORDER.indexOf(plan as typeof PLAN_ORDER[number]);
}

export function BillingPlansPage() {
  const vm = useBillingPlansPage();
  const header = <header className="page-head billing-plans__header">
    <div>
      <span className="eyebrow">CONTA</span>
      <h1 className="billing-plans__title">Planos e Assinatura</h1>
      <p className="page-lead billing-plans__subtitle">Gerencie seu plano e acompanhe o uso dos recursos.</p>
    </div>
  </header>;

  if (vm.loading && !vm.subscription) {
    return (
      <div className="billing-plans page-container">
        {header}
        <div className="billing-plans__skeleton">
          <div className="billing-plans__skeleton-card" style={{ height: 180 }} />
          <div className="billing-plans__skeleton-card" style={{ height: 140 }} />
          <div className="billing-plans__skeleton-grid">
            <div className="billing-plans__skeleton-card" style={{ height: 380 }} />
            <div className="billing-plans__skeleton-card" style={{ height: 380 }} />
            <div className="billing-plans__skeleton-card" style={{ height: 380 }} />
          </div>
        </div>
      </div>
    );
  }

  if (vm.error && !vm.subscription) {
    return (
      <div className="billing-plans page-container">
        {header}
        <div className="billing-plans__error">
          <span className="billing-plans__error-text">{vm.error}</span>
          <button type="button" className="billing-plans__error-btn" onClick={vm.refresh}>
            Tentar novamente
          </button>
        </div>
      </div>
    );
  }

  const sub = vm.subscription;
  if (!sub) return null;

  const currentPlanIndex = getPlanIndex(vm.currentPlan);
  const currentPlanDef = vm.plans.find((p) => p.key === vm.currentPlan);

  const meters: UsageMeter[] = [
    {
      label: "Compras confirmadas",
      current: sub.usage?.orders_current ?? 0,
      limit: sub.usage?.orders_limit ?? null,
      percentage: vm.usagePercentages.orders,
    },
    ...(sub.usage?.voice_sessions_limit ? [{
      label: "Sessões por voz",
      current: sub.usage.voice_sessions_current ?? 0,
      limit: sub.usage.voice_sessions_limit,
      percentage: vm.usagePercentages.voiceSessions,
    }] : []),
    {
      label: "Conexões",
      current: sub.usage?.commerce_connections_current ?? 0,
      limit: sub.usage?.commerce_connections_limit ?? null,
      percentage: vm.usagePercentages.connections,
    },
  ];

  return (
    <div className="billing-plans page-container">
      {header}

      {/* Overage warning: Starter/Growth excedeu limite de pedidos */}
      {sub.usage?.commercial_status === "grace" && (
        <div style={{
          padding: "14px 16px",
          borderRadius: 10,
          background: "color-mix(in oklab, #F59E0B 10%, transparent)",
          border: "1px solid color-mix(in oklab, #F59E0B 30%, transparent)",
          display: "flex",
          alignItems: "center",
          gap: 10,
          marginBottom: 8,
        }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#F59E0B" strokeWidth="2">
            <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
            <line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" />
          </svg>
          <div style={{ font: "500 12.5px var(--font-sans)", color: "var(--color-text)" }}>
            O limite mensal de pedidos foi atingido. Sua loja continua recebendo pedidos até {sub.usage?.grace_expires_at ? new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(new Date(sub.usage.grace_expires_at)) : "o fim das 72 horas"}. Atualize o plano para manter a operação ativa.
          </div>
        </div>
      )}

      {sub.usage?.commercial_status === "suspended" && (
        <div role="alert" style={{
          padding: "14px 16px",
          borderRadius: 10,
          background: "color-mix(in oklab, var(--color-error) 10%, transparent)",
          border: "1px solid color-mix(in oklab, var(--color-error) 30%, transparent)",
          display: "flex",
          alignItems: "center",
          gap: 10,
          marginBottom: 8,
          color: "var(--color-text)",
          font: "500 12.5px var(--font-sans)",
        }}>
          Novos pedidos estão suspensos porque a janela de 72 horas terminou. Atualize o plano para reabrir a loja agora ou aguarde o início das cotas do próximo mês.
        </div>
      )}

      {/* Whitelabel notice: Starter mostra badge */}
      {vm.currentPlan === "starter" && (
        <div style={{
          padding: "14px 16px",
          borderRadius: 10,
          background: "color-mix(in oklab, var(--color-brand) 6%, transparent)",
          border: "1px solid color-mix(in oklab, var(--color-brand) 20%, transparent)",
          display: "flex",
          alignItems: "center",
          gap: 10,
          marginBottom: 8,
        }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--color-brand)" strokeWidth="2">
            <path d="M12 2L2 7l10 5 10-5-10-5z" /><path d="M2 17l10 5 10-5" /><path d="M2 12l10 5 10-5" />
          </svg>
          <div style={{ font: "500 12.5px var(--font-sans)", color: "var(--color-text)" }}>
            Plano Free — o badge <b>"Powered by Zyon"</b> é exibido no checkout. Módulos avançados (Voice, Crypto, A/B Tests, Marketplace) não estão disponíveis. Faça upgrade para desbloquear.
          </div>
        </div>
      )}

      {vm.error && <p role="alert" className="billing-plans__error-text">{vm.error}</p>}
      {new URLSearchParams(window.location.search).get("billing") === "success" && (
        <p role="status">Pagamento enviado. A assinatura será atualizada após a confirmação. <button type="button" onClick={() => void vm.refresh()}>Atualizar</button></p>
      )}
      {vm.notice && <p role="status">{vm.notice}</p>}
      {sub.pending_plan && sub.pending_effective_at && <p role="status">Alteração agendada: {sub.pending_plan === "growth" ? "Growth" : sub.pending_plan === "scale" ? "Scale" : "Free"}, {sub.pending_billing_cycle === "annual" ? "anual" : "mensal"}, a partir de {new Date(sub.pending_effective_at).toLocaleDateString("pt-BR")}. {sub.pending_billing_amount_cents != null && <>Próxima cobrança: {billingMoney(sub.pending_billing_amount_cents)}.</>}</p>}
      {/* Current plan + Usage */}
      <div className="billing-plans__top-grid">
        <CurrentPlanCard
          planName={sub.plan_name ?? currentPlanDef?.name ?? sub.plan}
          monthlyPrice={sub.monthly_price_brl ?? currentPlanDef?.price ?? 0}
          billingCycle={sub.billing_cycle}
          billingAmountCents={sub.billing_amount_cents}
          transactionFeeCents={sub.transaction_fee_cents ?? 0}
          nextBillingDate={sub.status === "trialing" ? sub.trial_end : sub.current_period_end}
          daysRemaining={vm.daysRemaining}
          status={sub.status}
          cancelAtPeriodEnd={sub.cancel_at_period_end}
          onManage={vm.manageSubscription}
          canManage={Boolean(sub.has_billing_customer)}
          isLoading={vm.upgrading}
        />
        <UsageMeters meters={meters} />
      </div>

      {/* Plan cards */}
      <section className="billing-plans__plans-section">
        <div
          style={{
            font: "600 10.5px var(--font-mono)",
            letterSpacing: "0.06em",
            color: "var(--color-text-faint)",
            marginBottom: 16,
          }}
        >
          PLANOS DISPONÍVEIS
        </div>
        <BillingCycleSelector value={vm.billingCycle} onChange={vm.setBillingCycle} annualAvailable={vm.annualAvailable} discountPercent={vm.discountPercent} />
        {vm.pendingChange && <div className="billing-plans__change-review" role="region" aria-label="Revisar alteração">
          <h3>Confira a alteração</h3>
          <p>{vm.pendingChange.name} · {vm.billingCycle === "annual" ? "anual" : "mensal"} · {billingMoney(selectedBillingOffer(vm.pendingChange, vm.billingCycle)!.amountCents)} por período.</p>
          <p>A alteração depende da próxima cobrança confirmada{sub.current_period_end ? ", prevista para " + new Date(sub.current_period_end).toLocaleDateString("pt-BR") : ""}. As cotas de compras continuam mensais. As tarifas por transação são cobradas separadamente.</p>
          <button type="button" disabled={vm.upgrading} onClick={() => void vm.confirmChange()}>Confirmar alteração</button>{" "}
          <button type="button" disabled={vm.upgrading} onClick={vm.dismissChange}>Voltar</button>
        </div>}
        <div className="billing-plans__plans-grid">
          {vm.plans.map((plan) => {
            const planIndex = getPlanIndex(plan.key);
            const isCurrent = plan.key === vm.currentPlan && (plan.key === "starter" || vm.billingCycle === (sub.billing_cycle ?? "monthly"));
            const isDowngrade = planIndex < currentPlanIndex;

            return (
              <PlanCard
                key={plan.key}
                plan={plan}
                billingCycle={vm.billingCycle}
                isCurrent={isCurrent}
                isDowngrade={isDowngrade}
                onUpgrade={() => void vm.upgrade(plan.key)}
                upgrading={vm.upgrading || Boolean(sub.pending_plan)}
                actionLabel={plan.key === vm.currentPlan && !isCurrent ? (vm.billingCycle === "annual" ? "Mudar para anual" : "Mudar para mensal") : undefined}
              />
            );
          })}
        </div>
      </section>
    </div>
  );
}
