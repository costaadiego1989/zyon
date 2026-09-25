import { readSubscriptionCycle } from "../../auth/subscription-intent.js";
import type { BillingCycle } from "@zyon/shared-types";
import { useEffect, useState } from "react";
import { useApi } from "../../hooks/useApi.js";
import { showToast } from "../../components/Toast.js";
import type { BillingSubscription } from "../../api/types.js";
import type { PlanDef } from "./components/PlanCard.js";
import { toPlanDef, selectedBillingOffer } from "./plan-catalog.js";

export function useBillingPlansPage() {
  const api = useApi();
  const [billingCycle, setBillingCycle] = useState<BillingCycle>(readSubscriptionCycle);
  const [pendingChange, setPendingChange] = useState<PlanDef | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
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
      const required = subscription?.usage?.required_plan;
      const order = ["starter", "growth", "scale"];
      if (plan && required && order.indexOf(plan) < order.indexOf(required)) {
        setError(`O plano ${required === "scale" ? "Scale" : "Growth"} tem a capacidade necessária para o uso deste mês.`);
        return;
      }
      const hasSubscription = subscription?.has_subscription && !["cancelled", "canceled", "incomplete_expired"].includes(subscription.status);
      if (plan && plan !== "starter" && !selectedBillingOffer(plans.find(p => p.key === plan)!, billingCycle)) {
        setError("O anual está indisponível. Selecione o mensal para continuar."); return;
      }
      if (plan && plan !== "starter" && hasSubscription) {
        setPendingChange(plans.find(p => p.key === plan) ?? null); return;
      }
      if (subscription?.billing_provider === "asaas" && !plan) {
        setError("Esta assinatura não possui Portal Stripe. Para alterar o plano, selecione Growth ou Scale abaixo."); return;
      }
      const session = !plan || hasSubscription || plan === "starter"
        ? await api.createBillingPortalSession({})
        : await api.createBillingCheckoutSession({ plan, billingCycle });
      window.location.assign(session.url);
    } catch {
      const message = "Não foi possível abrir o pagamento. Tente novamente em instantes.";
      setError(message);
      showToast("error", message);
    } finally { setUpgrading(false); }
  }
  async function confirmChange() {
    if (!pendingChange || pendingChange.key === "starter") return;
    setUpgrading(true); setError(null);
    try {
      await api.changeBillingPlan({ targetPlan: pendingChange.key, billingCycle });
      setPendingChange(null);
      setNotice("Alteração registrada. Confira abaixo a data de vigência.");
      await refresh();
    } catch { setError("Não foi possível agendar a alteração. Seu plano atual continua válido."); }
    finally { setUpgrading(false); }
  }
  const usage = subscription?.usage;
  const percentage = (current?: number | null, limit?: number | null) => limit && limit > 0 ? Math.round((current ?? 0) / limit * 100) : 0;
  const date = subscription?.status === "trialing" ? subscription.trial_end : subscription?.current_period_end;
  return {
    loading, upgrading, error, subscription, plans, refresh, notice,
    billingCycle, setBillingCycle: (cycle: BillingCycle) => { setPendingChange(null); setBillingCycle(cycle); },
    pendingChange, dismissChange: () => setPendingChange(null), confirmChange,
    annualAvailable: plans.some(p => p.annualCheckoutAvailable),
    discountPercent: plans.flatMap(p => p.billingOptions ?? []).find(o => o.cycle === "annual")?.discountPercent ?? 0,
    upgrade: (plan: PlanDef["key"]) => openStripe(plan),
    manageSubscription: () => openStripe(), cancelSubscription: () => openStripe(),
    currentPlan: subscription?.plan ?? null,
    daysRemaining: date ? Math.max(0, Math.ceil((new Date(date).getTime() - Date.now()) / 86_400_000)) : null,
    usagePercentages: {
      orders: percentage(usage?.orders_current, usage?.orders_limit),
      connections: percentage(usage?.commerce_connections_current, usage?.commerce_connections_limit),
    },
  };
}
