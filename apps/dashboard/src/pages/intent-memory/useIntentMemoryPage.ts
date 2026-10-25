import { useCallback, useEffect, useRef, useState } from "react";
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
const emptyDistribution = (): IntentDistribution => ({
  price_sensitive: 0,
  ready_to_buy: 0,
  speed_focused: 0,
  browsing: 0,
  exploring: 0,
});
function settingsConfig(settings: Record<string, unknown>): IntentMemoryConfig {
  const config = settings.intentMemory as
    | Partial<IntentMemoryConfig>
    | undefined;
  return { intent_tracking_enabled: config?.intent_tracking_enabled !== false };
}
export function useIntentMemoryPage(props: { me: MerchantProfile | null }) {
  const api = useApi();
  const [distribution, setDistribution] =
    useState<IntentDistribution>(emptyDistribution);
  const [config, setConfig] = useState<IntentMemoryConfig>({
    intent_tracking_enabled: false,
  });
  const [signals, setSignals] = useState<IntentSignal[]>([]);
  const [loading, setLoading] = useState(true),
    [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState(""),
    [saveError, setSaveError] = useState("");
  const reading = useRef(0),
    working = useRef(false);
  const reload = useCallback(async () => {
    if (!props.me || working.current) return;
    const request = ++reading.current;
    setLoading(true);
    setLoadError("");
    try {
      const [settings, records] = await Promise.all([
        api.getStoreSettings(),
        api.getIntentMemoryRecords(),
      ]);
      if (request !== reading.current) return;
      const dist = emptyDistribution();
      for (const record of records) {
        const key = record.primary_intent as keyof IntentDistribution;
        if (Object.hasOwn(dist, key)) dist[key]++;
        else dist.exploring++;
      }
      setConfig(settingsConfig(settings));
      setDistribution(dist);
      setSignals(
        records.map((record) => ({
          intent: record.primary_intent,
          urgency: record.urgency,
          budget: record.budget_tier,
          pain_points: record.pain_points ?? [],
          created_at: record.created_at,
        }))
      );
    } catch (error) {
      reportError({ source: "intent-memory.load", error });
      if (request === reading.current)
        setLoadError(
          "Não foi possível consultar a configuração e os perfis. Tente novamente."
        );
    } finally {
      if (request === reading.current) setLoading(false);
    }
  }, [api, props.me?.id]);
  useEffect(() => {
    void reload();
    return () => {
      reading.current++;
    };
  }, [reload]);
  async function handleToggleTracking(enabled: boolean) {
    if (working.current || loading || loadError) return;
    working.current = true;
    setSaving(true);
    setSaveError("");
    try {
      const settings = await api.putStoreSettings({
        intentMemory: { intent_tracking_enabled: enabled },
      });
      setConfig(settingsConfig(settings));
      showToast("success", "Configuração da memória de intenção salva");
    } catch (error) {
      reportError({ source: "intent-memory.toggle", error });
      setSaveError(
        "Não foi possível salvar. A configuração anterior foi mantida. Tente novamente."
      );
    } finally {
      working.current = false;
      setSaving(false);
    }
  }
  return {
    distribution,
    config,
    loading,
    saving,
    signals,
    loadError,
    saveError,
    reload,
    handleToggleTracking,
  };
}
