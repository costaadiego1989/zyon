import { useEffect, useRef, useState } from "react";
import { useApi } from "../../hooks/useApi.js";
import { showToast } from "../../components/Toast.js";
import type { CrossSellConfig, CrossSellTouchpoint, CrossSellStrategy } from "@zyon/shared-types";
import { CROSS_SELL_STRATEGIES, normalizeCrossSellConfig } from "@zyon/shared-types";

const DEFAULT: CrossSellConfig = {
  enabled: false,
  touchpoints: { browsing: false, pre_cart: true, post_cart: false, pre_checkout: false, pre_payment: true, post_purchase: false },
  strategies: ["same_category"],
  limits: { maxSuggestionsPerSession: 2, cooldownSeconds: 120 },
  discount: { enabled: false, percent: 10 },
  display: { mode: "inline" },
};
function normalize(config: Partial<CrossSellConfig>): CrossSellConfig {
  return normalizeCrossSellConfig({ ...DEFAULT, ...config, touchpoints: { ...DEFAULT.touchpoints, ...config.touchpoints } });
}
export type CrossSellContext = "store" | "checkout";
export interface CrossSellPageState { config: CrossSellConfig; loading: boolean; saving: boolean; }

export function useCrossSellPage(context: CrossSellContext) {
  const api = useApi();
  const [state, setState] = useState<CrossSellPageState>({ config: DEFAULT, loading: true, saving: false });
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedConfig, setSavedConfig] = useState<CrossSellConfig | null>(null);
  const [attempt, setAttempt] = useState(0);
  const savingRef = useRef(false);
  useEffect(() => {
    let cancelled = false;
    setState(p => ({ ...p, loading: true })); setLoadError(null);
    api.getCrossSellConfig().then(raw => {
      if (cancelled) return;
      const config = normalize(raw);
      setSavedConfig({ ...config, strategies: raw.strategies ?? config.strategies }); setState(p => ({ ...p, config, loading: false }));
    }).catch(() => {
      if (!cancelled) { setLoadError("Não foi possível carregar as configurações. Tente novamente antes de editar."); setState(p => ({ ...p, loading: false })); }
    });
    return () => { cancelled = true; };
  }, [api, attempt]);
  const visibleTouchpoints: CrossSellTouchpoint[] = ["pre_cart", "pre_checkout", "pre_payment"];
  function patchConfig(partial: Partial<CrossSellConfig>) {
    if (savingRef.current || state.loading || loadError) return;
    setState(p => ({ ...p, config: { ...p.config, ...partial,
      touchpoints: { ...p.config.touchpoints, ...partial.touchpoints }, limits: { ...p.config.limits, ...partial.limits },
      discount: { ...p.config.discount, ...partial.discount }, display: { ...p.config.display, ...partial.display } } }));
  }
  function toggleTouchpoint(tp: CrossSellTouchpoint) { patchConfig({ touchpoints: { ...state.config.touchpoints, [tp]: !state.config.touchpoints[tp] } }); }
  function selectTouchpoint(tp: CrossSellTouchpoint) {
    const next = { ...state.config.touchpoints }; for (const key of visibleTouchpoints) next[key] = key === tp;
    patchConfig({ touchpoints: next });
  }
  function selectStrategy(strategy: CrossSellStrategy) {
    patchConfig({ strategies: [strategy] });
  }
  const { config } = state;
  const fieldErrors: Record<string, string> = {};
  if (config.enabled) {
    if (!visibleTouchpoints.some(moment => config.touchpoints[moment])) fieldErrors.moments = "Escolha pelo menos um momento para sugerir produtos.";
    if (config.strategies.length !== 1 || !CROSS_SELL_STRATEGIES.includes(config.strategies[0]!)) fieldErrors.strategy = "Escolha uma única estratégia para orientar as recomendações.";
    if (!Number.isInteger(config.limits.maxSuggestionsPerSession) || config.limits.maxSuggestionsPerSession < 1 || config.limits.maxSuggestionsPerSession > 5) fieldErrors.max = "Informe de 1 a 5 sugestões.";
    if (!Number.isInteger(config.limits.cooldownSeconds) || config.limits.cooldownSeconds < 30 || config.limits.cooldownSeconds > 600) fieldErrors.cooldown = "Informe de 30 a 600 segundos.";
    if (config.discount.enabled && (config.discount.mode ?? "percent") === "percent" && (!Number.isInteger(config.discount.percent) || config.discount.percent < 1 || config.discount.percent > 50)) fieldErrors.percent = "Informe de 1% a 50%.";
    if (config.discount.enabled && config.discount.mode === "coupon" && !config.discount.couponCode?.trim()) fieldErrors.coupon = "Informe o código de um cupom ativo.";
  }
  async function save() {
    if (savingRef.current || state.loading || loadError) return;
    if (Object.keys(fieldErrors).length) { setSaveError("Revise os campos indicados antes de salvar."); return; }
    savingRef.current = true; setSaveError(null); setState(p => ({ ...p, saving: true }));
    try {
      const saved = normalize(await api.putCrossSellConfig(config));
      setSavedConfig(saved); setState(p => ({ ...p, config: saved }));
      showToast("success", "Configurações de produtos complementares salvas");
    } catch { setSaveError("Não foi possível salvar. Seus ajustes foram mantidos. Tente novamente."); }
    finally { savingRef.current = false; setState(p => ({ ...p, saving: false })); }
  }
  return { state, context, visibleTouchpoints, patchConfig, toggleTouchpoint, selectTouchpoint, selectStrategy, save,
    loadError, saveError, fieldErrors, dirty: savedConfig !== null && JSON.stringify(config) !== JSON.stringify(savedConfig), reload: () => setAttempt(v => v + 1) };
}
