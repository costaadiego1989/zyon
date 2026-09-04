import { useState, useEffect, useCallback } from "react";
import type { MerchantProfile } from "../../api-client.js";
import { useApi } from "../../hooks/useApi.js";
import { showToast } from "../../components/Toast.js";

export interface CrmConnectionDTO {
  id: string;
  provider: string;
  status: "connected" | "disconnected" | "error";
  lastSyncAt?: string | null;
}

export interface CrmSyncLogDTO {
  id: string;
  provider: string;
  email: string;
  stage: "lead" | "customer";
  status: "success" | "failed";
  error_code: string | null;
  created_at: string;
}

export function useIntegrationsPage(options: { me: MerchantProfile | null }) {
  const api = useApi();
  const [crmConnections, setCrmConnections] = useState<CrmConnectionDTO[]>([]);
  const [syncLog, setSyncLog] = useState<CrmSyncLogDTO[]>([]);
  const [loading, setLoading] = useState(false);

  const loadData = useCallback(async () => {
    if (!options.me) return;
    setLoading(true);
    try {
      const list = await (api as any).getCrmConnections?.(options.me.id)?.catch?.(() => []) ?? [];
      setCrmConnections(Array.isArray(list) ? list : []);
      const log = await (api as any).getCrmSyncLog?.(50)?.catch?.(() => []) ?? [];
      setSyncLog(Array.isArray(log) ? log : []);
    } catch {
      setCrmConnections([]);
      setSyncLog([]);
    } finally {
      setLoading(false);
    }
  }, [api, options.me]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const connectCrm = useCallback(async (provider: string, credentials: Record<string, string>) => {
    if (!options.me) return;
    try {
      const conn = await (api as any).connectCrm?.(options.me.id, provider, credentials);
      if (conn) setCrmConnections((prev) => [...prev.filter((c) => c.provider !== provider), conn]);
      showToast("success", `${provider} conectado com sucesso`);
    } catch (err) {
      showToast("error", err instanceof Error ? err.message : `Erro ao conectar ${provider}`);
    }
  }, [api, options.me]);

  const disconnectCrm = useCallback(async (connectionId: string) => {
    if (!options.me) return;
    try {
      await (api as any).disconnectCrm?.(options.me.id, connectionId);
      setCrmConnections((prev) => prev.filter((c) => c.id !== connectionId));
      showToast("success", "CRM desconectado");
    } catch (err) {
      showToast("error", err instanceof Error ? err.message : "Erro ao desconectar");
    }
  }, [api, options.me]);

  return {
    crmConnections,
    syncLog,
    loading,
    connectCrm,
    disconnectCrm,
  };
}
