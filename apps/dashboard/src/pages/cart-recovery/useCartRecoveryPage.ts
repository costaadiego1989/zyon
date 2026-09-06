import { useCallback, useEffect, useState } from "react";
import { useApi } from "../../hooks/useApi.js";
import { reportError } from "../../hooks/useErrorReporter.js";
import { showToast } from "../../components/Toast.js";
import { normalizeCartRecoveryMetrics } from "../../api/endpoints/cart-recovery-metrics.js";
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

const EMPTY_METRICS = normalizeCartRecoveryMetrics(null);

const DEFAULT_CONFIG: CartRecoveryStrategyConfig = {
  active_strategy: "offer_coupon",
  coupon_code: undefined,
  rule_id: undefined,
};

export interface CouponOption {
  id: string;
  code: string;
  type: string;
  value: number;
  isActive: boolean;
}

export interface RuleOption {
  id: string;
  name: string;
}

export function useCartRecoveryPage() {
  const api = useApi();
  const [metrics, setMetrics] = useState<CartRecoveryMetrics | null>(null);
  const [attempts, setAttempts] = useState<CartRecoveryAttempt[]>([]);
  const [strategies, setStrategies] = useState<CartRecoveryStrategyPreferences>(DEFAULT_STRATEGIES);
  const [config, setConfig] = useState<CartRecoveryStrategyConfig>(DEFAULT_CONFIG);
  const [savingKey, setSavingKey] = useState<CartRecoveryStrategyKey | null>(null);
  const [loading, setLoading] = useState(true);

  // Available coupons and rules for selection
  const [coupons, setCoupons] = useState<CouponOption[]>([]);
  const [rules, setRules] = useState<RuleOption[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const [metRaw, attData, stratData, cfgData, couponData, settingsData] = await Promise.all([
          api.getCartRecoveryMetrics?.().catch(() => null),
          api.getCartRecoveryAttempts?.().catch(() => null),
          api.getCartRecoveryStrategies?.().catch(() => null),
          api.getCartRecoveryConfig?.().catch(() => null),
          api.listCoupons?.().catch(() => null),
          api.getCheckoutSettings?.().catch(() => null),
        ]);
        if (cancelled) return;

        // Normalize metrics
        const normalizedMetrics = normalizeCartRecoveryMetrics(metRaw);

        setMetrics(normalizedMetrics);
        setAttempts(attData ?? []);
        if (stratData) setStrategies({ ...DEFAULT_STRATEGIES, ...stratData });
        if (cfgData) setConfig(cfgData);

        // Load available coupons (only active)
        if (couponData) {
          setCoupons((couponData as unknown as CouponOption[]).filter((c) => c.isActive));
        }

        // Load available rules from checkout settings
        if (settingsData && (settingsData as any).advancedRules) {
          setRules(((settingsData as any).advancedRules as any[]).map((r: any) => ({
            id: r.id,
            name: r.name ?? r.label ?? r.id,
          })));
        }
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
    coupons,
    rules,
  };
}
