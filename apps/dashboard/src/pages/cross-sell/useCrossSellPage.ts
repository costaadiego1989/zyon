import { useEffect, useState } from "react";
import { useApi } from "../../hooks/useApi.js";
import { showToast } from "../../components/Toast.js";
import type { CrossSellConfig, CrossSellTouchpoint, CrossSellStrategy } from "@zyon/shared-types";

const DEFAULT: CrossSellConfig = {
  enabled: false,
  touchpoints: { browsing: true, pre_cart: false, pre_payment: true, post_purchase: false },
  strategies: ["same_category", "ai_personalized"],
  limits: { maxSuggestionsPerSession: 2, cooldownSeconds: 120 },
  discount: { enabled: false, percent: 10 },
  display: { mode: "inline" },
};

export type CrossSellContext = "store" | "checkout";

export interface CrossSellPageState {
  config: CrossSellConfig;
  loading: boolean;
  saving: boolean;
}

export function useCrossSellPage(context: CrossSellContext) {
  const api = useApi();
  const [state, setState] = useState<CrossSellPageState>({
    config: DEFAULT,
    loading: true,
    saving: false,
  });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const config = await api.getCrossSellConfig();
        if (cancelled) return;
        setState((p) => ({ ...p, config: { ...DEFAULT, ...config }, loading: false }));
      } catch {
        if (!cancelled) setState((p) => ({ ...p, loading: false }));
      }
    })();
    return () => { cancelled = true; };
  }, [api]);

  const visibleTouchpoints: CrossSellTouchpoint[] = context === "store"
    ? ["browsing", "pre_cart"]
    : ["pre_payment", "post_purchase"];

  function patchConfig(partial: Partial<CrossSellConfig>) {
    setState((p) => ({
      ...p,
      config: {
        ...p.config,
        ...partial,
        touchpoints: { ...p.config.touchpoints, ...(partial.touchpoints ?? {}) },
        limits: { ...p.config.limits, ...(partial.limits ?? {}) },
        discount: { ...p.config.discount, ...(partial.discount ?? {}) },
        display: { ...p.config.display, ...(partial.display ?? {}) },
      },
    }));
  }

  function toggleTouchpoint(tp: CrossSellTouchpoint) {
    setState((p) => ({
      ...p,
      config: {
        ...p.config,
        touchpoints: { ...p.config.touchpoints, [tp]: !p.config.touchpoints[tp] },
      },
    }));
  }

  /**
   * Select a single touchpoint within the current context (mutually exclusive):
   * enables `tp` and disables the other touchpoints visible in this context.
   * Touchpoints from the other context are left untouched.
   */
  function selectTouchpoint(tp: CrossSellTouchpoint) {
    setState((p) => {
      const next = { ...p.config.touchpoints };
      for (const key of visibleTouchpoints) {
        next[key] = key === tp;
      }
      return { ...p, config: { ...p.config, touchpoints: next } };
    });
  }

  function toggleStrategy(strategy: CrossSellStrategy) {
    setState((p) => {
      const has = p.config.strategies.includes(strategy);
      return {
        ...p,
        config: {
          ...p.config,
          strategies: has
            ? p.config.strategies.filter((s) => s !== strategy)
            : [...p.config.strategies, strategy],
        },
      };
    });
  }

  async function save() {
    setState((p) => ({ ...p, saving: true }));
    try {
      await api.putCrossSellConfig(state.config);
      showToast("success", "Configurações de Cross Sell salvas");
    } catch {
      showToast("error", "Erro ao salvar configurações");
    } finally {
      setState((p) => ({ ...p, saving: false }));
    }
  }

  return {
    state,
    context,
    visibleTouchpoints,
    patchConfig,
    toggleTouchpoint,
    selectTouchpoint,
    toggleStrategy,
    save,
  };
}
