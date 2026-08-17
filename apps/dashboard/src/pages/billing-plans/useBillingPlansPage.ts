import { useEffect, useState } from "react";
import { useApi } from "../../hooks/useApi.js";
import { showToast } from "../../components/Toast.js";
import type { BillingSubscription } from "../../api/types.js";

export interface BillingPlansPageVM {
  loading: boolean;
  error: string | null;
  subscription: BillingSubscription | null;
  upgrade: (plan: "starter" | "growth" | "scale") => Promise<void>;
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
    try {
      const session = await api.createBillingCheckoutSession({
        plan: plan as any,
      } as any);
      if (session.url) {
        window.location.href = session.url;
      }
    } catch (err) {
      setError("Erro ao iniciar upgrade");
      console.error(err);
    } finally {
      setUpgrading(false);
    }
  }

  async function manageSubscription() {
    try {
      const session = await api.createBillingPortalSession({
        return_url: window.location.href,
      });
      if (session.url) {
        window.location.href = session.url;
      } else {
        showToast("error", "Portal indisponível no momento");
      }
    } catch (err) {
      showToast("error", "Não foi possível abrir o portal de assinatura");
      console.error(err);
    }
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
    manageSubscription,
    usagePercentages,
    daysRemaining,
    currentPlan,
    upgrading,
    refresh: fetchSubscription,
  };
}
