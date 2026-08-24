import { useEffect, useState, useCallback } from "react";
import { useApi } from "../../hooks/useApi.js";
import { showToast } from "../../components/Toast.js";
import { reportError } from "../../hooks/useErrorReporter.js";
import type { M2MAgentResponse, M2MProtocolConfigResponse } from "../../api/endpoints/m2m-management.js";

export type M2MTab = "config" | "agents" | "sessions" | "webhooks";

export interface CheckoutProgramavelVM {
  tab: M2MTab;
  setTab: (t: M2MTab) => void;
  agents: M2MAgentResponse[];
  config: M2MProtocolConfigResponse;
  loading: boolean;
  saving: boolean;
  refresh: () => void;
  handleCreateAgent: (data: { displayName: string; globalUserId: string }) => Promise<void>;
  handleSuspendAgent: (agentId: string, suspend: boolean) => Promise<void>;
  handleSaveConfig: (data: Partial<M2MProtocolConfigResponse>) => Promise<void>;
}

const DEFAULT_CONFIG: M2MProtocolConfigResponse = {
  merchantId: "",
  enabled: false,
  webhookUrl: null,
  webhookEndpointId: null,
  maxSessionTtlMinutes: 30,
};

export function useCheckoutProgramavel(): CheckoutProgramavelVM {
  const api = useApi();
  const [tab, setTab] = useState<M2MTab>("config");
  const [agents, setAgents] = useState<M2MAgentResponse[]>([]);
  const [config, setConfig] = useState<M2MProtocolConfigResponse>(DEFAULT_CONFIG);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const [agentsRes, configRes] = await Promise.all([
        api.getM2MAgents(),
        api.getProtocolConfig(),
      ]);
      setAgents(agentsRes.agents);
      setConfig(configRes);
    } catch (e) {
      reportError({ source: "checkout-programavel.load", error: e });
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  const handleCreateAgent = useCallback(async (data: { displayName: string; globalUserId: string }) => {
    setSaving(true);
    try {
      const agent = await api.createM2MAgent(data);
      setAgents((prev) => [agent, ...prev]);
      showToast("success", `Agente "${agent.displayName}" criado`);
    } catch (e) {
      reportError({ source: "checkout-programavel.createAgent", error: e });
      showToast("error", e instanceof Error ? e.message : "Erro ao criar agente");
    } finally {
      setSaving(false);
    }
  }, [api]);

  const handleSuspendAgent = useCallback(async (agentId: string, suspend: boolean) => {
    try {
      await api.suspendM2MAgent(agentId, suspend);
      setAgents((prev) => prev.map((a) => a.id === agentId ? { ...a, status: suspend ? "suspended" : "active" } : a));
      showToast("success", suspend ? "Agente suspenso" : "Agente reativado");
    } catch (e) {
      reportError({ source: "checkout-programavel.suspendAgent", error: e });
      showToast("error", e instanceof Error ? e.message : "Erro ao alterar status");
    }
  }, [api]);

  const handleSaveConfig = useCallback(async (data: Partial<M2MProtocolConfigResponse>) => {
    setSaving(true);
    try {
      const updated = await api.putProtocolConfig(data);
      setConfig(updated);
      showToast("success", "Configuração salva");
    } catch (e) {
      reportError({ source: "checkout-programavel.saveConfig", error: e });
      showToast("error", e instanceof Error ? e.message : "Erro ao salvar configuração");
    } finally {
      setSaving(false);
    }
  }, [api]);

  return {
    tab,
    setTab,
    agents,
    config,
    loading,
    saving,
    refresh: loadAll,
    handleCreateAgent,
    handleSuspendAgent,
    handleSaveConfig,
  };
}
