import { useCallback, useEffect, useState } from "react";
import { useApi } from "../useApi.js";
import type { BillingSubscription } from "../../api/types.js";

/**
 * Current billing entitlements. Refreshes on mount, focus and every minute.
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
  reload: () => void;
}

export function usePlanFeatures(): PlanFeaturesState {
  const api = useApi();
  const [subscription, setSubscription] = useState<BillingSubscription | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const reload = useCallback(() => setRevision(value => value + 1), []);

  useEffect(() => {
    let cancelled = false;
    let inFlight = false;
    setLoading(true);
    async function refresh() {
      if (inFlight) return;
      inFlight = true;
      try {
        const sub = await api.getBillingSubscription();
        if (cancelled) return;
        setSubscription(sub);
        setError(null);
      } catch {
        if (!cancelled) setError("Erro ao carregar plano");
      } finally {
        inFlight = false;
        if (!cancelled) setLoading(false);
      }
    }
    void refresh();
    const onFocus = () => { void refresh(); };
    const timer = window.setInterval(onFocus, 60_000);
    window.addEventListener("focus", onFocus);
    return () => { cancelled = true; window.clearInterval(timer); window.removeEventListener("focus", onFocus); };
  }, [api, revision]);

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
    reload,
  };
}
