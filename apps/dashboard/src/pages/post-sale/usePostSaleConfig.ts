import { useEffect, useRef, useState } from "react";
import { useApi } from "../../hooks/useApi.js";
import { showToast } from "../../components/Toast.js";
import { reportError } from "../../hooks/useErrorReporter.js";
import type { MerchantProfile } from "../../api-client.js";

export interface PostSaleCampaignConfig {
  followUpEnabled: boolean;
  reviewEnabled: boolean;
  reviewDelayDays: number;
  npsEnabled: boolean;
  npsDelayDays: number;
  crossSellEnabled: boolean;
  crossSellDelayDays: number;
  winBackEnabled: boolean;
  winBackThresholdDays: number;
  loyaltyEnabled: boolean;
  loyaltyMilestones: string;
  reorderEnabled: boolean;
}

const DEFAULT_CONFIG: PostSaleCampaignConfig = {
  followUpEnabled: true,
  reviewEnabled: true,
  reviewDelayDays: 3,
  npsEnabled: true,
  npsDelayDays: 7,
  crossSellEnabled: true,
  crossSellDelayDays: 5,
  winBackEnabled: false,
  winBackThresholdDays: 30,
  loyaltyEnabled: false,
  loyaltyMilestones: "3,5,10",
  reorderEnabled: false,
};

export function usePostSaleConfig(props: { me: MerchantProfile | null }) {
  const api = useApi();
  const [config, setConfig] = useState<PostSaleCampaignConfig>(DEFAULT_CONFIG);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const working = useRef(false);

  useEffect(() => {
    if (!props.me) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setLoadError(null);
      try {
        const storeSettings = (await api.getStoreSettings?.()) as Record<string, unknown> | undefined;
        const saved = (storeSettings as any)?.postSaleCampaigns as Partial<PostSaleCampaignConfig> | undefined;
        if (cancelled) return;
        setConfig({ ...DEFAULT_CONFIG, ...saved });
      } catch (e) {
        reportError({ source: "post-sale-config.load", error: e });
        if (!cancelled) setLoadError("Não foi possível carregar as campanhas. Tente novamente antes de alterar a configuração.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [api, props.me, attempt]);

  async function save(next: PostSaleCampaignConfig) {
    if (working.current || loading || loadError) return;
    working.current = true;
    setSaveError(null);
    setSaving(true);
    const prev = config;
    setConfig(next);
    try {
      await api.putStoreSettings({ postSaleCampaigns: next });
      showToast("success", "Configuração salva");
    } catch (e) {
      setConfig(prev);
      reportError({ source: "post-sale-config.save", error: e });
      setSaveError("Não foi possível salvar a campanha. A configuração anterior foi restaurada; tente novamente.");
    } finally {
      setSaving(false);
      working.current = false;
    }
  }

  function update<K extends keyof PostSaleCampaignConfig>(key: K, value: PostSaleCampaignConfig[K]) {
    void save({ ...config, [key]: value });
  }

  return { config, loading, saving, update, loadError, saveError, reload: () => setAttempt(value => value + 1) };
}
