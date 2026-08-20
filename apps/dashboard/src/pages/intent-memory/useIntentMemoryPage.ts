import { useEffect, useState } from "react";
import { useApi } from "../../hooks/useApi.js";
import { showToast } from "../../components/Toast.js";
import { reportError } from "../../hooks/useErrorReporter.js";
import type { MerchantProfile } from "../../api-client.js";

export interface IntentDistribution {
  price_sensitive: number;
  quality_seeker: number;
  speed_focused: number;
  sustainability_conscious: number;
  other: number;
}

export interface IntentMemoryConfig {
  intent_tracking_enabled: boolean;
}

export function useIntentMemoryPage(props: { me: MerchantProfile | null }) {
  const api = useApi();
  const [distribution, setDistribution] = useState<IntentDistribution>({
    price_sensitive: 0,
    quality_seeker: 0,
    speed_focused: 0,
    sustainability_conscious: 0,
    other: 0,
  });
  const [config, setConfig] = useState<IntentMemoryConfig>({ intent_tracking_enabled: false });
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loaded, setLoaded] = useState(false);

  // Load data on mount
  useEffect(() => {
    if (!props.me) {
      setLoaded(true);
      return;
    }
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        // Mock API calls — replace with real endpoints
        const configData = (await Promise.resolve({ intent_tracking_enabled: false })) as IntentMemoryConfig | undefined;
        const distData = (await Promise.resolve({
          price_sensitive: 0,
          quality_seeker: 0,
          speed_focused: 0,
          sustainability_conscious: 0,
          other: 0,
        })) as IntentDistribution | undefined;
        if (cancelled) return;
        setConfig(configData ?? { intent_tracking_enabled: false });
        setDistribution(distData ?? {
          price_sensitive: 0,
          quality_seeker: 0,
          speed_focused: 0,
          sustainability_conscious: 0,
          other: 0,
        });
      } catch (e) {
        reportError({ source: "intent-memory.load", error: e });
        if (!cancelled) {
          showToast("error", e instanceof Error ? e.message : "Erro ao carregar Intent Memory");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
          setLoaded(true);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [api, props.me]);

  async function handleToggleTracking(enabled: boolean) {
    setSaving(true);
    try {
      // Mock API call — replace with real endpoint
      setConfig({ intent_tracking_enabled: enabled });
      showToast("success", enabled ? "Intent Memory ativado" : "Intent Memory desativado");
    } catch (e) {
      reportError({ source: "intent-memory.toggle", error: e });
      showToast("error", e instanceof Error ? e.message : "Erro ao atualizar configuração");
    } finally {
      setSaving(false);
    }
  }

  return {
    distribution,
    config,
    loading,
    loaded,
    saving,
    handleToggleTracking,
  };
}
