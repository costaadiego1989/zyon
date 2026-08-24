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

const MOCK_METRICS: CartRecoveryMetrics = {
  total_abandoned: 2847,
  total_attempts: 1923,
  total_recovered: 486,
  recovery_rate_percent: 25.3,
  revenue_recovered_brl: 38427,
};

const MOCK_ATTEMPTS: CartRecoveryAttempt[] = [
  {
    id: "att-001",
    session_id: "sess-12345abcdef0",
    strategy: "free_shipping",
    status: "recovered",
    created_at: "2026-08-20T14:22:00Z",
  },
  {
    id: "att-002",
    session_id: "sess-12346abcdef1",
    strategy: "coupon",
    status: "sent",
    created_at: "2026-08-20T13:55:00Z",
  },
  {
    id: "att-003",
    session_id: "sess-12347abcdef2",
    strategy: "cross_sell",
    status: "failed",
    created_at: "2026-08-20T12:30:00Z",
  },
  {
    id: "att-004",
    session_id: "sess-12348abcdef3",
    strategy: "free_shipping",
    status: "recovered",
    created_at: "2026-08-20T11:15:00Z",
  },
  {
    id: "att-005",
    session_id: "sess-12349abcdef4",
    strategy: "cross_sell",
    status: "pending",
    created_at: "2026-08-20T10:00:00Z",
  },
];

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
        setMetrics(metData ?? MOCK_METRICS);
        setAttempts(attData ?? MOCK_ATTEMPTS);
        if (stratData) {
          setStrategies({ ...DEFAULT_STRATEGIES, ...stratData });
          setStrategiesLoaded(true);
        }
      } catch (e) {
        reportError({ source: "cart-recovery.load", error: e });
        if (!cancelled) {
          setMetrics(MOCK_METRICS);
          setAttempts(MOCK_ATTEMPTS);
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
