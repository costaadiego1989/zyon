import { useEffect, useState } from "react";
import { useApi } from "../../hooks/useApi.js";
import { showToast } from "../../components/Toast.js";
import { reportError } from "../../hooks/useErrorReporter.js";
import type { MerchantProfile } from "../../api-client.js";

export interface IntentDistribution {
  price_sensitive: number;
  ready_to_buy: number;
  speed_focused: number;
  browsing: number;
  exploring: number;
}

export interface IntentSignal {
  intent: string;
  urgency: string;
  budget: string;
  pain_points: string[];
  created_at: string;
}

export interface IntentMemoryConfig {
  intent_tracking_enabled: boolean;
}

export function useIntentMemoryPage(props: { me: MerchantProfile | null }) {
  const api = useApi();
  const [distribution, setDistribution] = useState<IntentDistribution>({
    price_sensitive: 0,
    ready_to_buy: 0,
    speed_focused: 0,
    browsing: 0,
    exploring: 0,
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

        // Compute distribution from real records, keyed by the backend's
        // canonical primary_intent enum (no substring guessing — the API is
        // the source of truth). Unknown/legacy values fall into `exploring`.
        if (records && records.length > 0) {
          const dist: IntentDistribution = {
            price_sensitive: 0,
            ready_to_buy: 0,
            speed_focused: 0,
            browsing: 0,
            exploring: 0,
          };
          for (const r of records) {
            const key = r.primary_intent as keyof IntentDistribution;
            if (key in dist) dist[key]++;
            else dist.exploring++;
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
