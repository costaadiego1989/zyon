import { useEffect, useState } from "react";
import { useApi } from "../../hooks/useApi.js";
import { showToast } from "../../components/Toast.js";
import type { BillingSubscription } from "../../api/types.js";

export interface BillingPlansPageVM {
  loading: boolean;
  error: string | null;
  subscription: BillingSubscription | null;
  upgrade: (plan: "starter" | "growth" | "scale") => Promise<void>;
  cancelSubscription: () => Promise<void>;
  manageSubscription: () => Promise<void>;
  usagePercentages: {
    orders: number;
    sessions: number;
    aiConversations: number;
    connections: number;
  };
  daysRemaining: number | null;
  currentPlan: "starter" | "growth" | "scale" | null;
  upgrading: boolean;
  refresh: () => Promise<void>;
}

export function useBillingPlansPage(): BillingPlansPageVM {
  const api = useApi();
  const [loading, setLoading] = useState(true);
  const [upgrading, setUpgrading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [subscription, setSubscription] = useState<BillingSubscription | null>(null);

  useEffect(() => {
    void fetchSubscription();
  }, []);

  async function fetchSubscription() {
    setLoading(true);
    setError(null);
    try {
      const sub = await api.getBillingSubscription();
      setSubscription(sub);
    } catch (err) {
      setError("Erro ao carregar assinatura");
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  async function upgrade(plan: "starter" | "growth" | "scale") {
    if (!subscription) return;
    if (subscription.plan === plan) return; // Already on this plan

    setUpgrading(true);
    setError(null);
    try {
      const updated = await api.changeBillingPlan({ targetPlan: plan });
      setSubscription(updated);
      const isDowngrade =
        (updated.plan !== plan) && Boolean((updated as { pending_plan_key?: string }).pending_plan_key);
      showToast(
        "success",
        isDowngrade
          ? "Downgrade agendado para o fim do período atual."
          : "Plano atualizado com sucesso!",
      );
    } catch (err: any) {
      const body = String(err?.responseBody ?? err?.message ?? "");
      const msg = body.includes("no_active_subscription")
        ? "Você precisa assinar um plano pago com cartão primeiro (no onboarding ou pelo botão Assinar)."
        : "Não foi possível alterar o plano. Tente novamente.";
      setError(msg);
      showToast("error", msg);
      console.error(err);
    } finally {
      setUpgrading(false);
    }
  }

  async function cancelSubscription() {
    if (!subscription) return;
    setUpgrading(true);
    setError(null);
    try {
      const updated = await api.cancelBillingSubscription({ immediate: false });
      setSubscription(updated);
      showToast("success", "Assinatura cancelada. Acesso mantido até o fim do período pago.");
    } catch (err) {
      showToast("error", "Não foi possível cancelar a assinatura.");
      console.error(err);
    } finally {
      setUpgrading(false);
    }
  }

  async function manageSubscription() {
    // Asaas has no hosted portal — management happens in-app via upgrade/cancel.
    await fetchSubscription();
  }

  const currentPlan = (subscription?.plan ?? null) as "starter" | "growth" | "scale" | null;

  const usage = (subscription as any)?.usage ?? {} as any;
  const usagePercentages = {
    orders: usage.orders_limit ? Math.round(((usage.orders_current ?? 0) / usage.orders_limit) * 100) : 0,
    sessions: usage.sessions_limit ? Math.round(((usage.sessions_current ?? 0) / usage.sessions_limit) * 100) : 0,
    aiConversations: usage.ai_conversations_limit
      ? Math.round(((usage.ai_conversations_current ?? 0) / usage.ai_conversations_limit) * 100)
      : 0,
    connections: usage.commerce_connections_limit
      ? Math.round(((usage.commerce_connections_current ?? 0) / usage.commerce_connections_limit) * 100)
      : 0,
  };

  let daysRemaining: number | null = null;
  if (subscription?.current_period_end) {
    const now = new Date();
    const end = new Date(subscription.current_period_end);
    const diff = Math.ceil((end.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
    daysRemaining = Math.max(0, diff);
  }

  return {
    loading,
    error,
    subscription,
    upgrade,
    cancelSubscription,
    manageSubscription,
    usagePercentages,
    daysRemaining,
    currentPlan,
    upgrading,
    refresh: fetchSubscription,
  };
}
