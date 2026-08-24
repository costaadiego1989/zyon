import { useCallback, useEffect, useState } from "react";
import { useApi } from "../../hooks/useApi.js";
import { reportError } from "../../hooks/useErrorReporter.js";
import { showToast } from "../../components/Toast.js";
import type {
  CartRecoveryMetrics,
  CartRecoveryAttempt,
  CartRecoveryStrategyPreferences,
  CartRecoveryStrategyKey,
} from "../../api/endpoints/cart-recovery.js";

const DEFAULT_STRATEGIES: CartRecoveryStrategyPreferences = {
  offer_free_shipping: false,
  personalized_cross_sell: false,
  offer_coupon: true,
  advanced_rule: false,
};

const EMPTY_METRICS: CartRecoveryMetrics = {
  total_abandoned: 0,
  total_attempts: 0,
  total_recovered: 0,
  recovery_rate_percent: 0,
  revenue_recovered_brl: 0,
};

export function useCartRecoveryPage() {
  const api = useApi();
  const [metrics, setMetrics] = useState<CartRecoveryMetrics | null>(null);
  const [attempts, setAttempts] = useState<CartRecoveryAttempt[]>([]);
  const [strategies, setStrategies] = useState<CartRecoveryStrategyPreferences>(DEFAULT_STRATEGIES);
  const [strategiesLoaded, setStrategiesLoaded] = useState(false);
  const [savingKey, setSavingKey] = useState<CartRecoveryStrategyKey | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const [metData, attData, stratData] = await Promise.all([
          api.getCartRecoveryMetrics?.().catch(() => null),
          api.getCartRecoveryAttempts?.().catch(() => null),
          api.getCartRecoveryStrategies?.().catch(() => null),
        ]);
        if (cancelled) return;
        setMetrics(metData ?? EMPTY_METRICS);
        setAttempts(attData ?? []);
        if (stratData) {
          setStrategies({ ...DEFAULT_STRATEGIES, ...stratData });
          setStrategiesLoaded(true);
        }
      } catch (e) {
        reportError({ source: "cart-recovery.load", error: e });
        if (!cancelled) {
          setMetrics(EMPTY_METRICS);
          setAttempts([]);
        }
      } finally {
        if (!cancelled) {
          setStrategiesLoaded(true);
          setLoading(false);
        }
      }
    })();
    return () => { cancelled = true; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  /**
   * Only one strategy active at a time.
   * Selecting a key disables all others and enables the selected one.
   */
  const selectStrategy = useCallback(async (key: CartRecoveryStrategyKey) => {
    if (strategies[key]) return; // already active

    const previous = { ...strategies };
    const next: CartRecoveryStrategyPreferences = {
      offer_free_shipping: false,
      personalized_cross_sell: false,
      offer_coupon: false,
      advanced_rule: false,
      [key]: true,
    };

    setStrategies(next);
    setSavingKey(key);
    try {
      const saved = await api.patchCartRecoveryStrategies(next);
      setStrategies({ ...DEFAULT_STRATEGIES, ...saved });
      showToast("success", "Estratégia ativada");
    } catch (e) {
      setStrategies(previous);
      reportError({ source: "cart-recovery.select", error: e });
      showToast("error", e instanceof Error ? e.message : "Erro ao salvar estratégia");
    } finally {
      setSavingKey(null);
    }
  }, [api, strategies]);

  return {
    metrics,
    attempts,
    strategies,
    strategiesLoaded,
    savingKey,
    loading,
    selectStrategy,
  };
}
