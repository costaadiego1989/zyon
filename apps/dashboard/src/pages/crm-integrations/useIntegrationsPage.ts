import { useState, useEffect, useCallback, useRef } from "react";
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
  const [loading, setLoading] = useState(true);
  const [connectionsError, setConnectionsError] = useState<string | null>(null);
  const [logError, setLogError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const working = useRef(false);
  const generation = useRef(0);
  const loadData = useCallback(async () => {
    if (!options.me) {
      setLoading(false);
      return;
    }
    const current = ++generation.current;
    setLoading(true);
    const [connections, logs] = await Promise.allSettled([
      api.getCrmConnections(options.me.id),
      api.getCrmSyncLog(50),
    ]);
    if (current !== generation.current) return;
    setConnectionsError(
      connections.status === "rejected"
        ? "Não foi possível consultar as conexões. Tente novamente antes de configurar um CRM."
        : null
    );
    setLogError(
      logs.status === "rejected" ? "Não foi possível consultar o histórico de sincronização." : null
    );
    if (connections.status === "fulfilled") setCrmConnections(connections.value);
    if (logs.status === "fulfilled") setSyncLog(logs.value);
    setLoading(false);
  }, [api, options.me?.id]);
  useEffect(() => {
    void loadData();
    return () => {
      generation.current++;
    };
  }, [loadData]);
  const connectCrm = async (provider: string, credentials: Record<string, string>) => {
    if (!options.me || working.current) return false;
    working.current = true;
    setBusy(true);
    setActionError(null);
    try {
      const conn = await api.connectCrm(options.me.id, provider, credentials);
      if (!conn?.id) throw new Error("missing_connection");
      setCrmConnections((prev) => [...prev.filter((c) => c.provider !== provider), conn]);
      showToast("success", "Conexão cadastrada. Confira o estado e acompanhe a sincronização.");
      return true;
    } catch {
      setActionError(
        "Não foi possível conectar. Confira o token e as permissões no provedor e tente novamente."
      );
      return false;
    } finally {
      working.current = false;
      setBusy(false);
    }
  };
  const disconnectCrm = async (connectionId: string) => {
    if (!options.me || working.current) return false;
    working.current = true;
    setBusy(true);
    setActionError(null);
    try {
      await api.disconnectCrm(options.me.id, connectionId);
      setCrmConnections((prev) => prev.filter((c) => c.id !== connectionId));
      showToast("success", "CRM desconectado");
      return true;
    } catch {
      setActionError("Não foi possível desconectar o CRM. Tente novamente.");
      return false;
    } finally {
      working.current = false;
      setBusy(false);
    }
  };
  return {
    crmConnections,
    syncLog,
    loading,
    connectionsError,
    logError,
    actionError,
    busy,
    connectCrm,
    disconnectCrm,
    loadData,
    clearActionError: () => setActionError(null),
  };
}
