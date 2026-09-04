import { useEffect, useState } from "react";
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
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!props.me) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const storeSettings = (await api.getStoreSettings?.()) as Record<string, unknown> | undefined;
        const saved = (storeSettings as any)?.postSaleCampaigns as Partial<PostSaleCampaignConfig> | undefined;
        if (cancelled) return;
        if (saved) setConfig({ ...DEFAULT_CONFIG, ...saved });
      } catch (e) {
        reportError({ source: "post-sale-config.load", error: e });
        if (!cancelled) showToast("error", e instanceof Error ? e.message : "Erro ao carregar configuração");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [api, props.me]);

  async function save(next: PostSaleCampaignConfig) {
    setSaving(true);
    const prev = config;
    setConfig(next);
    try {
      await api.putStoreSettings({ postSaleCampaigns: next });
      showToast("success", "Configuração salva");
    } catch (e) {
      setConfig(prev);
      reportError({ source: "post-sale-config.save", error: e });
      showToast("error", e instanceof Error ? e.message : "Erro ao salvar configuração");
    } finally {
      setSaving(false);
    }
  }

  function update<K extends keyof PostSaleCampaignConfig>(key: K, value: PostSaleCampaignConfig[K]) {
    void save({ ...config, [key]: value });
  }

  return { config, loading, saving, update };
}
