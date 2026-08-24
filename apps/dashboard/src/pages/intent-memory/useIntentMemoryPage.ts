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
  const [signals, setSignals] = useState<Array<{ intent: string; urgency: string; budget: string; pain_points: string[]; created_at: string }>>([]);

  useEffect(() => {
    if (!props.me) {
      setLoaded(true);
      return;
    }
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        // Load config from storeSettings
        const storeSettings = await api.getStoreSettings?.() as Record<string, unknown> | undefined;
        const intentConfig = (storeSettings as any)?.intentMemory as IntentMemoryConfig | undefined;

        // Load intent records from API
        const records = await api.getIntentMemoryRecords?.() as Array<{ primary_intent: string; urgency: string; budget_tier: string; pain_points: string[]; created_at: string }> | undefined;

        if (cancelled) return;

        setConfig(intentConfig ?? { intent_tracking_enabled: false });

        // Compute distribution from real records
        if (records && records.length > 0) {
          const dist: IntentDistribution = {
            price_sensitive: 0,
            quality_seeker: 0,
            speed_focused: 0,
            sustainability_conscious: 0,
            other: 0,
          };
          for (const r of records) {
            const intent = r.primary_intent?.toLowerCase() ?? "";
            if (intent.includes("preco") || intent.includes("price") || intent.includes("barato") || intent.includes("desconto")) dist.price_sensitive++;
            else if (intent.includes("qualidade") || intent.includes("quality") || intent.includes("premium") || intent.includes("melhor")) dist.quality_seeker++;
            else if (intent.includes("rapido") || intent.includes("urgente") || intent.includes("speed") || intent.includes("entrega")) dist.speed_focused++;
            else if (intent.includes("sustent") || intent.includes("eco") || intent.includes("green")) dist.sustainability_conscious++;
            else dist.other++;
          }
          setDistribution(dist);
          setSignals(records.map(r => ({
            intent: r.primary_intent,
            urgency: r.urgency,
            budget: r.budget_tier,
            pain_points: r.pain_points ?? [],
            created_at: r.created_at,
          })));
        }
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
    return () => { cancelled = true; };
  }, [api, props.me]);

  async function handleToggleTracking(enabled: boolean) {
    setSaving(true);
    try {
      await api.putStoreSettings({ intentMemory: { intent_tracking_enabled: enabled } });
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
    signals,
    handleToggleTracking,
  };
}
