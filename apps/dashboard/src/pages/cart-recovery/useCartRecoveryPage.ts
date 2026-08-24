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
  offer_free_shipping: true,
  personalized_cross_sell: true,
  offer_coupon: true,
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

  const toggleStrategy = useCallback(async (key: CartRecoveryStrategyKey) => {
    const previous = strategies[key];
    const next = !previous;
    setStrategies((prev) => ({ ...prev, [key]: next }));
    setSavingKey(key);
    try {
      const saved = await api.patchCartRecoveryStrategies({ [key]: next });
      setStrategies((prev) => ({ ...prev, ...saved }));
      showToast("success", next ? "Estratégia ativada" : "Estratégia desativada");
    } catch (e) {
      setStrategies((prev) => ({ ...prev, [key]: previous }));
      reportError({ source: "cart-recovery.toggle", error: e });
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
    toggleStrategy,
  };
}
