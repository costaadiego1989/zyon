import { useCallback, useEffect, useState } from "react";
import { useApi } from "../../hooks/useApi.js";
import { reportError } from "../../hooks/useErrorReporter.js";
import { showToast } from "../../components/Toast.js";
import type {
  CartRecoveryMetrics,
  CartRecoveryAttempt,
  CartRecoveryStrategyPreferences,
  CartRecoveryStrategyKey,
  CartRecoveryStrategyConfig,
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

const DEFAULT_CONFIG: CartRecoveryStrategyConfig = {
  active_strategy: "offer_coupon",
  coupon_code: undefined,
  rule_id: undefined,
};

export function useCartRecoveryPage() {
  const api = useApi();
  const [metrics, setMetrics] = useState<CartRecoveryMetrics | null>(null);
  const [attempts, setAttempts] = useState<CartRecoveryAttempt[]>([]);
  const [strategies, setStrategies] = useState<CartRecoveryStrategyPreferences>(DEFAULT_STRATEGIES);
  const [config, setConfig] = useState<CartRecoveryStrategyConfig>(DEFAULT_CONFIG);
  const [savingKey, setSavingKey] = useState<CartRecoveryStrategyKey | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const [metRaw, attData, stratData, cfgData] = await Promise.all([
          api.getCartRecoveryMetrics?.().catch(() => null),
          api.getCartRecoveryAttempts?.().catch(() => null),
          api.getCartRecoveryStrategies?.().catch(() => null),
          api.getCartRecoveryConfig?.().catch(() => null),
        ]);
        if (cancelled) return;

        // Normalize metrics (API field names may differ from dashboard type)
        const raw = metRaw as Record<string, any> | null;
        const normalizedMetrics: CartRecoveryMetrics = raw ? {
          total_abandoned: raw.total_abandoned ?? 0,
          total_attempts: raw.total_attempts ?? raw.recovery_attempts ?? 0,
          total_recovered: raw.total_recovered ?? raw.recovered ?? 0,
          recovery_rate_percent: raw.recovery_rate_percent ?? (raw.recovery_rate != null ? raw.recovery_rate * 100 : 0),
          revenue_recovered_brl: raw.revenue_recovered_brl ?? (raw.revenue_recovered_cents != null ? raw.revenue_recovered_cents / 100 : 0),
        } : EMPTY_METRICS;

        setMetrics(normalizedMetrics);
        setAttempts(attData ?? []);
        if (stratData) setStrategies({ ...DEFAULT_STRATEGIES, ...stratData });
        if (cfgData) setConfig(cfgData);
      } catch (e) {
        reportError({ source: "cart-recovery.load", error: e });
        if (!cancelled) {
          setMetrics(EMPTY_METRICS);
          setAttempts([]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  /**
   * Only one strategy active at a time.
   * Selecting a key disables all others and enables the selected one.
   * Also updates config.active_strategy.
   */
  const selectStrategy = useCallback(async (key: CartRecoveryStrategyKey) => {
    if (strategies[key]) return;

    const previous = { ...strategies };
    const prevConfig = { ...config };
    const next: CartRecoveryStrategyPreferences = {
      offer_free_shipping: false,
      personalized_cross_sell: false,
      offer_coupon: false,
      advanced_rule: false,
      [key]: true,
    };

    setStrategies(next);
    setConfig((c) => ({ ...c, active_strategy: key }));
    setSavingKey(key);
    try {
      const [savedStrat, savedCfg] = await Promise.all([
        api.patchCartRecoveryStrategies(next),
        api.patchCartRecoveryConfig({ active_strategy: key }),
      ]);
      setStrategies({ ...DEFAULT_STRATEGIES, ...savedStrat });
      setConfig(savedCfg);
      showToast("success", "Estratégia ativada");
    } catch (e) {
      setStrategies(previous);
      setConfig(prevConfig);
      reportError({ source: "cart-recovery.select", error: e });
      showToast("error", e instanceof Error ? e.message : "Erro ao salvar estratégia");
    } finally {
      setSavingKey(null);
    }
  }, [api, strategies, config]);

  /**
   * Save coupon_code or rule_id config
   */
  const saveConfig = useCallback(async (patch: Partial<CartRecoveryStrategyConfig>) => {
    const prevConfig = { ...config };
    const merged = { ...config, ...patch };
    setConfig(merged);
    try {
      const saved = await api.patchCartRecoveryConfig(patch);
      setConfig(saved);
      showToast("success", "Configuração salva");
    } catch (e) {
      setConfig(prevConfig);
      reportError({ source: "cart-recovery.config", error: e });
      showToast("error", e instanceof Error ? e.message : "Erro ao salvar configuração");
    }
  }, [api, config]);

  return {
    metrics,
    attempts,
    strategies,
    config,
    savingKey,
    loading,
    selectStrategy,
    saveConfig,
  };
}
