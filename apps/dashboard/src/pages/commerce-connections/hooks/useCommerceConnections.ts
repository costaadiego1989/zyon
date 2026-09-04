import { useState, useCallback, useEffect, useRef } from "react";
import type { CommerceConnection, ConnectCommercePayload } from "../../../api-client.js";
import { DashboardHttpError } from "../../../api-client.js";
import { useApi } from "../../../hooks/useApi.js";

export type Operation = "idle" | "loading" | "testing" | "connecting" | "syncing" | "deleting";

export interface CommerceConnectionsState {
  connections: CommerceConnection[];
  operation: Operation;
  alert: { message: string; kind: "success" | "error" } | null;
}

export function useCommerceConnections(me: { id: string } | null) {
  const api = useApi();
  const [connections, setConnections] = useState<CommerceConnection[]>([]);
  const [operation, setOperation] = useState<Operation>("idle");
  const [alert, setAlert] = useState<{ message: string; kind: "success" | "error" } | null>(null);
  const alertTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (alertTimerRef.current) clearTimeout(alertTimerRef.current);
    };
  }, []);

  // Reload when merchant changes
  useEffect(() => {
    if (!me) {
      setConnections([]);
      return;
    }
    void load();
  }, [me]); // eslint-disable-line react-hooks/exhaustive-deps

  function showAlert(message: string, kind: "success" | "error") {
    if (alertTimerRef.current) clearTimeout(alertTimerRef.current);
    setAlert({ message, kind });
    if (kind === "success") {
      alertTimerRef.current = setTimeout(() => setAlert(null), 8000);
    }
  }

  function dismissAlert() {
    setAlert(null);
  }

  const load = useCallback(async () => {
    setOperation("loading");
    setAlert(null);
    try {
      setConnections(await api.getCommerceConnections());
    } catch (e) {
      showAlert(sanitizeError(e), "error");
    } finally {
      setOperation("idle");
    }
  }, [api]);

  const createConnection = useCallback(
    async (payload: ConnectCommercePayload) => {
      setOperation("connecting");
      setAlert(null);
      try {
        const created = await api.createCommerceConnection(payload);
        setConnections([created]);
        showAlert("Conexão criada com sucesso.", "success");
        return created;
      } catch (e) {
        showAlert(sanitizeError(e), "error");
        throw e;
      } finally {
        setOperation("idle");
      }
    },
    [api],
  );

  const testConnection = useCallback(async () => {
    setOperation("testing");
    setAlert(null);
    try {
      const result = await api.testCommerceConnection();
      setConnections([result.connection]);
      showAlert(`Teste bem-sucedido — ${result.store_name} (${result.currency}).`, "success");
      return result;
    } catch (e) {
      showAlert(sanitizeError(e), "error");
      throw e;
    } finally {
      setOperation("idle");
    }
  }, [api]);

  const syncConnection = useCallback(async () => {
    setOperation("syncing");
    setAlert(null);
    try {
      const updated = await api.syncCommerceConnection();
      setConnections([updated]);
      showAlert("Produtos sincronizados com sucesso.", "success");
      return updated;
    } catch (e) {
      showAlert(sanitizeError(e), "error");
      throw e;
    } finally {
      setOperation("idle");
    }
  }, [api]);

  const deleteConnection = useCallback(async () => {
    setOperation("deleting");
    setAlert(null);
    try {
      await api.deleteCommerceConnection();
      setConnections([]);
      showAlert("Conexão removida.", "success");
    } catch (e) {
      showAlert(sanitizeError(e), "error");
      throw e;
    } finally {
      setOperation("idle");
    }
  }, [api]);

  return {
    // State
    connections,
    operation,
    alert,
    isBusy: operation !== "idle" && operation !== "loading",
    isLoading: operation === "loading",
    hasConnection: connections.length > 0,

    // Methods
    load,
    createConnection,
    testConnection,
    syncConnection,
    deleteConnection,
    showAlert,
    dismissAlert,
  };
}

// ─ Error Sanitization ────────────────────────────────────────────────────────

export function sanitizeError(e: unknown): string {
  if (e instanceof DashboardHttpError) {
    const { status } = e;
    if (status === 401) return "Sessão expirada. Faça login novamente.";
    if (status === 403) return "Sem permissão para esta ação.";
    if (status === 409) return "Já existe uma conexão ativa. Remova a atual primeiro.";
    if (status === 422) return "Não foi possível conectar. Verifique as credenciais e tente novamente.";
    if (status >= 500) return "Erro interno. Tente novamente em alguns minutos.";
    return "Ocorreu um erro inesperado. Tente novamente.";
  }
  if (e instanceof TypeError) return "Sem conexão com o servidor.";
  console.error("[commerce-connections]", e);
  return "Ocorreu um erro inesperado. Tente novamente.";
}
