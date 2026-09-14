import { useCallback, useEffect, useRef, useState } from "react";
import { useApi } from "../../hooks/useApi.js";
import { reportError } from "../../hooks/useErrorReporter.js";
import { showToast } from "../../components/Toast.js";
import { normalizeCartRecoveryMetrics } from "../../api/endpoints/cart-recovery-metrics.js";
import type { CartRecoveryMetrics, CartRecoveryAttempt, CartRecoveryStrategyKey, CartRecoveryStrategyConfig } from "../../api/endpoints/cart-recovery.js";

export interface CouponOption {
  id: string; code: string; discountType: string; discountValue: number;
  isActive: boolean; startsAt?: string; expiresAt?: string; maxUses?: number; usedCount?: number;
}
export interface RuleOption { id: string; name: string; }

export function useCartRecoveryPage() {
  const api = useApi();
  const [metrics, setMetrics] = useState<CartRecoveryMetrics | null>(null);
  const [attempts, setAttempts] = useState<CartRecoveryAttempt[]>([]);
  const [config, setConfig] = useState<CartRecoveryStrategyConfig>({ active_strategy: "offer_coupon" });
  const [savingKey, setSavingKey] = useState<CartRecoveryStrategyKey | null>(null);
  const saving = useRef(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [loadVersion, setLoadVersion] = useState(0);
  const [coupons, setCoupons] = useState<CouponOption[]>([]);
  const [rules, setRules] = useState<RuleOption[]>([]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    Promise.all([
      api.getCartRecoveryMetrics(), api.getCartRecoveryAttempts(),
      api.getCartRecoveryConfig(), api.listCoupons(), api.getCheckoutSettings(),
    ]).then(([rawMetrics, attemptData, savedConfig, couponData, settings]) => {
      if (cancelled) return;
      setMetrics(normalizeCartRecoveryMetrics(rawMetrics));
      setAttempts(attemptData);
      setConfig(savedConfig);
      const now = Date.now();
      setCoupons((couponData as unknown as CouponOption[]).filter(c => c.isActive
        && (!c.startsAt || new Date(c.startsAt).getTime() <= now)
        && (!c.expiresAt || new Date(c.expiresAt).getTime() > now)
        && (!c.maxUses || (c.usedCount ?? 0) < c.maxUses)));
      setRules((settings.advancedRules ?? []).filter(rule => rule.enabled).map(rule => ({ id: rule.id, name: rule.name })));
    }).catch(cause => {
      if (cancelled) return;
      reportError({ source: "cart-recovery.load", error: cause });
      setError("Não foi possível carregar a recuperação de carrinho. Tente novamente.");
    }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [api, loadVersion]);

  const saveConfig = useCallback(async (patch: Partial<CartRecoveryStrategyConfig>): Promise<boolean> => {
    if (saving.current || loading || error) return false;
    saving.current = true;
    setSavingKey(patch.active_strategy ?? config.active_strategy);
    try {
      // The API saves config and the single selected strategy in one transaction.
      const saved = await api.patchCartRecoveryConfig(patch);
      setConfig(saved);
      showToast("success", "Configuração salva");
      return true;
    } catch (cause) {
      reportError({ source: "cart-recovery.config", error: cause });
      showToast("error", cause instanceof Error ? cause.message : "Erro ao salvar configuração");
      return false;
    } finally {
      saving.current = false;
      setSavingKey(null);
    }
  }, [api, config.active_strategy, loading, error]);

  const selectStrategy = useCallback((key: CartRecoveryStrategyKey) => {
    if (key === config.active_strategy) return Promise.resolve(true);
    return saveConfig({ active_strategy: key });
  }, [config.active_strategy, saveConfig]);

  return { metrics, attempts, config, savingKey, loading, error,
    retry: () => setLoadVersion(value => value + 1), selectStrategy, saveConfig, coupons, rules };
}
