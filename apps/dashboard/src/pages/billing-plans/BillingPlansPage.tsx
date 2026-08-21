import React from "react";
import { useBillingPlansPage } from "./useBillingPlansPage.js";
import { CurrentPlanCard } from "./components/CurrentPlanCard.js";
import { UsageMeters, type UsageMeter } from "./components/UsageMeters.js";
import { PlanCard, type PlanDef } from "./components/PlanCard.js";
import "./billing-plans-page.css";

const PLANS: PlanDef[] = [
  {
    key: "starter",
    name: "Starter",
    price: 0,
    fee: "2,49%",
    limits: { orders: 100, sessions: 100, ai: 100, connections: 1 },
    features: [],
  },
  {
    key: "growth",
    name: "Growth",
    price: 249,
    fee: "1,99%",
    limits: { orders: 500, sessions: 1000, ai: 5000, connections: 2 },
    features: ["Voice checkout", "Face biometry", "Crypto payments"],
    recommended: true,
  },
  {
    key: "scale",
    name: "Scale",
    price: 599,
    fee: "1,49%",
    limits: { orders: -1, sessions: -1, ai: -1, connections: -1 },
    features: [
      "Voice checkout",
      "Face biometry",
      "Crypto payments",
      "White-label",
      "10 membros",
    ],
  },
];

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
  const currentPlanDef = PLANS.find((p) => p.key === vm.currentPlan);

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

      {/* Current plan + Usage */}
      <div className="billing-plans__top-grid">
        <CurrentPlanCard
          planName={sub.plan_name ?? currentPlanDef?.name ?? sub.plan}
          monthlyPrice={sub.monthly_price_brl ?? currentPlanDef?.price ?? 0}
          transactionFee={sub.transaction_fee_percent ?? 0}
          nextBillingDate={sub.current_period_end}
          daysRemaining={vm.daysRemaining}
          status={sub.status}
          cancelAtPeriodEnd={sub.cancel_at_period_end}
          onManage={vm.manageSubscription}
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
          {PLANS.map((plan) => {
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
