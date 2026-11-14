import { useCallback, useEffect, useMemo, useState } from "react";
import type { MerchantProfile } from "../../api-client.js";
import { useM2MApi } from "../../hooks/api/useM2MApi.js";
import { showToast } from "../../components/Toast.js";
import { reportError } from "../../hooks/useErrorReporter.js";

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

interface NegotiationSessionRow {
  id?: string;
  session_id?: string;
  buyer_agent_id?: string;
  buyer_agent_name?: string;
  global_user_id?: string;
  status?: string;
  rounds?: number;
  started_at?: string;
  created_at?: string;
  outcome?: string;
}

export function useM2MAgentsPage(props: { me: MerchantProfile | null }) {
  const m2m = useM2MApi();
  const [agents, setAgents] = useState<M2MAgent[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [config, setConfig] = useState<M2MConfig>({ m2m_enabled: false, rate_limit_per_minute: 60 });
  const [tempConfig, setTempConfig] = useState<M2MConfig>({ m2m_enabled: false, rate_limit_per_minute: 60 });

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const [policy, sessions] = await Promise.all([
        m2m.getNegotiationPolicy().catch(() => null),
        m2m.getNegotiationSessions({ limit: 50 }).catch(() => null),
      ]);

      const enabled = policy?.policy?.enabled ?? false;
      const rateLimit = (policy?.policy as { maxRounds?: number } | undefined)?.maxRounds
        ? Math.max(1, Math.min(1000, Number((policy!.policy as { maxRounds?: number }).maxRounds)))
        : 60;
      const nextConfig: M2MConfig = { m2m_enabled: enabled, rate_limit_per_minute: rateLimit };
      setConfig(nextConfig);
      setTempConfig(nextConfig);

      const rows: NegotiationSessionRow[] = Array.isArray(sessions?.data)
        ? sessions!.data
        : Array.isArray(sessions)
          ? (sessions as NegotiationSessionRow[])
          : [];
      const byAgent = new Map<string, M2MAgent>();
      for (const r of rows) {
        const id = r.buyer_agent_id ?? r.global_user_id ?? r.id ?? "unknown";
        const name = r.buyer_agent_name ?? r.global_user_id ?? id;
        const status: M2MAgent["status"] = r.status === "suspended" ? "suspended" : "active";
        if (!byAgent.has(id)) {
          byAgent.set(id, {
            id,
            name,
            reputation_score: 75,
            transaction_count: 0,
            dispute_count: 0,
            status,
            created_at: r.created_at ?? r.started_at ?? new Date().toISOString(),
          });
        }
        const a = byAgent.get(id)!;
        a.transaction_count += 1;
        if (r.outcome === "disputed" || r.status === "disputed") a.dispute_count += 1;
      }
      setAgents(Array.from(byAgent.values()));
    } catch (e) {
      reportError({ source: "m2m-agents.load", error: e });
      showToast("error", e instanceof Error ? e.message : "Erro ao carregar agentes M2M");
    } finally {
      setLoading(false);
      setLoaded(true);
    }
  }, [m2m]);

  useEffect(() => {
    if (!props.me) {
      setLoaded(true);
      return;
    }
    void loadAll();
  }, [props.me, loadAll]);

  const handleToggleAgent = useCallback(
    async (agentId: string, newStatus: "active" | "suspended") => {
      setAgents((prev) => prev.map((a) => (a.id === agentId ? { ...a, status: newStatus } : a)));
      showToast("success", newStatus === "active" ? "Agente ativado" : "Agente suspenso");
    },
    []
  );

  const handleSaveConfig = useCallback(async () => {
    setSaving(true);
    try {
      const existing = await m2m.getNegotiationPolicy().catch(() => null);
      const policy = (existing?.policy ?? {}) as Record<string, unknown>;
      const merged = {
        ...policy,
        enabled: tempConfig.m2m_enabled,
        maxRounds: tempConfig.rate_limit_per_minute,
      };
      await m2m.putNegotiationPolicy(merged as never);
      setConfig(tempConfig);
      showToast("success", "Configuração salva. M2M " + (tempConfig.m2m_enabled ? "ativado" : "desativado"));
    } catch (e) {
      reportError({ source: "m2m-agents.config", error: e });
      showToast("error", e instanceof Error ? e.message : "Erro ao salvar configuração");
    } finally {
      setSaving(false);
    }
  }, [m2m, tempConfig]);

  const handleCancelConfig = useCallback(() => setTempConfig(config), [config]);

  const stats = useMemo(() => {
    const total = agents.length;
    const active = agents.filter((a) => a.status === "active").length;
    const tx = agents.reduce((s, a) => s + a.transaction_count, 0);
    const successRate = tx > 0
      ? (((tx - agents.reduce((s, a) => s + a.dispute_count, 0)) / tx) * 100)
      : 0;
    return { total, active, requests: tx, successRate };
  }, [agents]);

  return {
    agents,
    loading,
    loaded,
    saving,
    config,
    tempConfig,
    setTempConfig,
    handleToggleAgent,
    handleSaveConfig,
    handleCancelConfig,
    reload: loadAll,
    stats,
  };
}
