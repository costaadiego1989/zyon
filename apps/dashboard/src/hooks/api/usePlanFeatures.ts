import { useEffect, useState } from "react";
import { useApi } from "../useApi.js";
import type { BillingSubscription } from "../../api/types.js";

/**
 * Cached billing plan features hook. Fetches subscription once, exposes:
 * - plan: "starter" | "growth" | "scale"
 * - features: Record<string, boolean>
 * - hasFeature(key): checks if feature is enabled in current plan
 * - loading/error states
 */
export interface PlanFeaturesState {
  plan: "starter" | "growth" | "scale" | null;
  features: Record<string, boolean>;
  transactionFeeCents: number;
  loading: boolean;
  error: string | null;
  hasFeature: (key: string) => boolean;
}

// Module-level cache so multiple components share the same data without
// redundant fetches (within same mount lifecycle).
let cachedSubscription: BillingSubscription | null = null;

export function usePlanFeatures(): PlanFeaturesState {
  const api = useApi();
  const [subscription, setSubscription] = useState<BillingSubscription | null>(cachedSubscription);
  const [loading, setLoading] = useState(!cachedSubscription);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (cachedSubscription) return;
    let cancelled = false;
    void (async () => {
      try {
        const sub = await api.getBillingSubscription();
        if (cancelled) return;
        cachedSubscription = sub;
        setSubscription(sub);
      } catch {
        if (!cancelled) setError("Erro ao carregar plano");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const plan = (subscription?.plan ?? null) as "starter" | "growth" | "scale" | null;
  const features = (subscription?.features ?? {}) as Record<string, boolean>;
  const transactionFeeCents = subscription?.transaction_fee_cents ?? 0;

  return {
    plan,
    features,
    transactionFeeCents,
    loading,
    error,
    hasFeature: (key: string) => features[key] === true,
  };
}
