import { useEffect, useMemo, useState } from "react";
import { useApi } from "../../hooks/useApi.js";
import { showToast } from "../../components/Toast.js";
import { reportError } from "../../hooks/useErrorReporter.js";
import type { MerchantProfile } from "../../api-client.js";

export interface M2MAgent {
  id: string;
  name: string;
  reputation_score: number;
  transaction_count: number;
  dispute_count: number;
  status: "active" | "suspended";
  created_at: string;
}

export interface M2MConfig {
  m2m_enabled: boolean;
  rate_limit_per_minute: number;
}

export function useM2MAgentsPage(props: { me: MerchantProfile | null }) {
  const api = useApi();
  const [agents, setAgents] = useState<M2MAgent[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [config, setConfig] = useState<M2MConfig>({ m2m_enabled: false, rate_limit_per_minute: 60 });
  const [isEditingConfig, setIsEditingConfig] = useState(false);
  const [tempConfig, setTempConfig] = useState<M2MConfig>({ m2m_enabled: false, rate_limit_per_minute: 60 });

  // Load agents on mount
  useEffect(() => {
    if (!props.me) {
      setLoaded(true);
      return;
    }
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        // Mock API call — replace with real endpoint
        const data = (await Promise.resolve([])) as M2MAgent[] | undefined;
        if (cancelled) return;
        setAgents(data ?? []);
      } catch (e) {
        reportError({ source: "m2m-agents.load", error: e });
        if (!cancelled) {
          showToast("error", e instanceof Error ? e.message : "Erro ao carregar agentes M2M");
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

  async function handleToggleAgent(agentId: string, newStatus: "active" | "suspended") {
    setSaving(true);
    try {
      // Mock API call — replace with real endpoint
      setAgents((prev) =>
        prev.map((a) => (a.id === agentId ? { ...a, status: newStatus } : a))
      );
      showToast("success", newStatus === "active" ? "Agente ativado" : "Agente suspenso");
    } catch (e) {
      reportError({ source: "m2m-agents.toggle", error: e });
      showToast("error", e instanceof Error ? e.message : "Erro ao atualizar agente");
    } finally {
      setSaving(false);
    }
  }

  async function handleSaveConfig() {
    setSaving(true);
    try {
      // Mock API call — replace with real endpoint
      setConfig(tempConfig);
      setIsEditingConfig(false);
      showToast("success", "Configuração atualizada");
    } catch (e) {
      reportError({ source: "m2m-agents.config", error: e });
      showToast("error", e instanceof Error ? e.message : "Erro ao salvar configuração");
    } finally {
      setSaving(false);
    }
  }

  function handleCancelConfig() {
    setTempConfig(config);
    setIsEditingConfig(false);
  }

  return {
    agents,
    loading,
    loaded,
    saving,
    config,
    isEditingConfig,
    tempConfig,
    setTempConfig,
    setIsEditingConfig,
    handleToggleAgent,
    handleSaveConfig,
    handleCancelConfig,
  };
}
