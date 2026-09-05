import { useEffect, useState } from "react";
import { useApi } from "../../hooks/useApi.js";
import { showToast } from "../../components/Toast.js";
import type { BillingSubscription } from "../../api/types.js";
import type { PlanDef } from "./components/PlanCard.js";
import { toPlanDef } from "./plan-catalog.js";

export function useBillingPlansPage() {
  const api = useApi();
  const [loading, setLoading] = useState(true);
  const [upgrading, setUpgrading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [subscription, setSubscription] = useState<BillingSubscription | null>(null);
  const [plans, setPlans] = useState<PlanDef[]>([]);
  async function refresh() {
    setLoading(true);
    setError(null);
    try {
      const [sub, catalog] = await Promise.all([api.getBillingSubscription(), api.listBillingPlans()]);
      setSubscription(sub);
      setPlans(catalog.map(toPlanDef));
    } catch {
      setError("Não foi possível carregar os planos. Tente novamente.");
    } finally { setLoading(false); }
  }
  useEffect(() => { void refresh(); }, [api]);
  async function openStripe(plan?: PlanDef["key"]) {
    setUpgrading(true);
    setError(null);
    try {
      const hasSubscription = subscription?.has_subscription && !["cancelled", "canceled", "incomplete_expired"].includes(subscription.status);
      const session = !plan || hasSubscription || plan === "starter"
        ? await api.createBillingPortalSession({})
        : await api.createBillingCheckoutSession({ plan });
      window.location.assign(session.url);
    } catch {
      const message = "Não foi possível abrir o pagamento. Tente novamente em instantes.";
      setError(message);
      showToast("error", message);
    } finally { setUpgrading(false); }
  }
  const usage = subscription?.usage;
  const percentage = (current?: number | null, limit?: number | null) => limit && limit > 0 ? Math.round((current ?? 0) / limit * 100) : 0;
  const date = subscription?.status === "trialing" ? subscription.trial_end : subscription?.current_period_end;
  return {
    loading, upgrading, error, subscription, plans, refresh,
    upgrade: (plan: PlanDef["key"]) => openStripe(plan),
    manageSubscription: () => openStripe(), cancelSubscription: () => openStripe(),
    currentPlan: subscription?.plan ?? null,
    daysRemaining: date ? Math.max(0, Math.ceil((new Date(date).getTime() - Date.now()) / 86_400_000)) : null,
    usagePercentages: {
      orders: percentage(usage?.orders_current, usage?.orders_limit),
      sessions: percentage(usage?.sessions_current, usage?.sessions_limit),
      aiConversations: percentage(usage?.ai_conversations_current, usage?.ai_conversations_limit),
      connections: percentage(usage?.commerce_connections_current, usage?.commerce_connections_limit),
    },
  };
}
