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

  if (vm.loading && !vm.subscription) {
    return (
      <div className="billing-plans">
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
      <div className="billing-plans">
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
      label: "Pedidos",
      current: sub.usage?.orders_current ?? 0,
      limit: sub.usage?.orders_limit ?? null,
      percentage: vm.usagePercentages.orders,
    },
    {
      label: "Sessões",
      current: sub.usage?.sessions_current ?? 0,
      limit: sub.usage?.sessions_limit ?? null,
      percentage: vm.usagePercentages.sessions,
    },
    {
      label: "Conversas IA",
      current: sub.usage?.ai_conversations_current ?? 0,
      limit: sub.usage?.ai_conversations_limit ?? null,
      percentage: vm.usagePercentages.aiConversations,
    },
    {
      label: "Conexões",
      current: sub.usage?.commerce_connections_current ?? 0,
      limit: sub.usage?.commerce_connections_limit ?? null,
      percentage: vm.usagePercentages.connections,
    },
  ];

  return (
    <div className="billing-plans">
      {/* Header */}
      <header className="billing-plans__header">
        <div
          style={{
            font: "600 10px var(--font-mono)",
            letterSpacing: "0.06em",
            color: "var(--color-text-faint)",
            marginBottom: 4,
          }}
        >
          CONTA
        </div>
        <h2 className="billing-plans__title">Planos e Assinatura</h2>
        <p className="billing-plans__subtitle">
          Gerencie seu plano e acompanhe o uso dos recursos.
        </p>
      </header>

      {/* Overage warning: Starter/Growth excedeu limite de pedidos */}
      {vm.usagePercentages.orders >= 100 && (
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
            Você ultrapassou o limite de pedidos do plano. Suas vendas continuam normalmente — considere fazer upgrade para um plano com mais capacidade.
          </div>
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
      {/* Current plan + Usage */}
      <div className="billing-plans__top-grid">
        <CurrentPlanCard
          planName={sub.plan_name ?? currentPlanDef?.name ?? sub.plan}
          monthlyPrice={sub.monthly_price_brl ?? currentPlanDef?.price ?? 0}
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
        <div className="billing-plans__plans-grid">
          {vm.plans.map((plan) => {
            const planIndex = getPlanIndex(plan.key);
            const isCurrent = plan.key === vm.currentPlan;
            const isDowngrade = planIndex < currentPlanIndex;

            return (
              <PlanCard
                key={plan.key}
                plan={plan}
                isCurrent={isCurrent}
                isDowngrade={isDowngrade}
                onUpgrade={() => void vm.upgrade(plan.key)}
                upgrading={vm.upgrading}
              />
            );
          })}
        </div>
      </section>
    </div>
  );
}
