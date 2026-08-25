import { useState, useEffect, useCallback } from "react";
import type { MerchantProfile } from "../../api-client.js";
import type { ErpConnectionDTO } from "../../api/endpoints/inventory.js";
import { useApi } from "../../hooks/useApi.js";
import { showToast } from "../../components/Toast.js";

export function useInventoryPage(options: {
  me: MerchantProfile | null;
}) {
  const api = useApi();
  const [summary, setSummary] = useState<any>(null);
  const [items, setItems] = useState<any[]>([]);
  const [movements, setMovements] = useState<any[]>([]);
  const [alerts, setAlerts] = useState<any[]>([]);
  const [locations, setLocations] = useState<any[]>([]);
  const [erpConnections, setErpConnections] = useState<ErpConnectionDTO[]>([]);
  const [crmConnections, setCrmConnections] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Pagination state
  const [itemPage, setItemPage] = useState(1);
  const [movementPage, setMovementPage] = useState(1);
  const pageSize = 10;

  // Tab state
  const [tab, setTab] = useState<"overview" | "movements" | "alerts" | "erp">("overview");

  const loadData = useCallback(async () => {
    if (!options.me) return;

    setLoading(true);
    setError(null);
    try {
      const [sum, itemList, moveList, alertList, locList, erpList, crmList] = await Promise.all([
        api.getInventorySummary(options.me.id).catch(() => null),
        api.listInventoryItems(options.me.id, { pageSize: 50 }).catch(() => null),
        api.listMovements(options.me.id, { pageSize: 50 }).catch(() => null),
        api.listAlerts(options.me.id, false).catch(() => null),
        api.listLocations(options.me.id).catch(() => null),
        api.getErpConnections(options.me.id).catch(() => []),
        (api as any).getCrmConnections?.(options.me!.id)?.catch?.(() => []) ?? Promise.resolve([]),
      ]);

      setSummary(sum ?? null);
      setItems(Array.isArray(itemList) ? itemList : itemList?.items ?? []);
      setMovements(Array.isArray(moveList) ? moveList : moveList?.movements ?? []);
      setAlerts(Array.isArray(alertList) ? alertList : []);
      setLocations(Array.isArray(locList) ? locList : []);
      setErpConnections(Array.isArray(erpList) ? erpList : []);
      setCrmConnections(Array.isArray(crmList) ? crmList : []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao carregar estoque");
    } finally {
      setLoading(false);
    }
  }, [api, options.me]);

  useEffect(() => {
    loadData();

    // Detect OAuth callback from ERP providers
    const params = new URLSearchParams(window.location.search);
    const erpConnected = params.get("erp_connected");
    if (erpConnected) {
      showToast("success", `${erpConnected} conectado com sucesso`);
      loadData(); // Reload to fetch updated connections
      // Clean URL
      window.history.replaceState({}, document.title, window.location.pathname);
    }
  }, [loadData]);

  const acknowledgeAlert = useCallback(async (alertId: string) => {
    if (!options.me) return;
    try {
      await api.acknowledgeAlert(options.me.id, alertId);
      setAlerts((prev) =>
        prev.map((a) =>
          a.id === alertId ? { ...a, acknowledged_at: new Date().toISOString() } : a,
        ),
      );
      showToast("success", "Alerta reconhecido");
    } catch (err) {
      showToast("error", err instanceof Error ? err.message : "Erro ao reconhecer alerta");
    }
  }, [api, options.me]);

  const recordMovement = useCallback(async (input: {
    itemId: string;
    kind: string;
    quantity: number;
    reason?: string;
  }) => {
    if (!options.me) return;
    try {
      await api.recordMovement(options.me.id, input.itemId, {
        kind: input.kind,
        quantity: input.quantity,
        reason: input.reason,
      });
      showToast("success", "Movimentação registrada");
      await loadData();
    } catch (err) {
      showToast("error", err instanceof Error ? err.message : "Erro ao registrar movimentação");
    }
  }, [api, options.me, loadData]);

  const connectErp = useCallback(async (provider: string, credentials?: Record<string, string>) => {
    if (!options.me) return;
    try {
      if (provider === "omie") {
        // Omie: direct API key connect via POST
        const conn = await api.connectErp(options.me.id, "omie", credentials);
        setErpConnections((prev) => [...prev.filter((c) => c.provider !== "omie"), conn]);
        showToast("success", "Omie conectado com sucesso");
      } else {
        // Bling/Tiny: OAuth flow — use proper API client
        const data = await (api as any).getErpOAuthUrl(options.me.id, provider);
        if (data?.url) {
          window.open(data.url, "_blank", "width=600,height=700");
        } else {
          showToast("error", "Não foi possível gerar URL de autorização");
        }
      }
    } catch (err) {
      showToast("error", err instanceof Error ? err.message : `Erro ao conectar ${provider}`);
    }
  }, [api, options.me]);

  const disconnectErp = useCallback(async (connectionId: string) => {
    if (!options.me) return;
    try {
      await api.disconnectErp(options.me.id, connectionId);
      setErpConnections((prev) => prev.filter((c) => c.id !== connectionId));
      showToast("success", "Conexão removida");
    } catch (err) {
      showToast("error", err instanceof Error ? err.message : "Erro ao desconectar");
    }
  }, [api, options.me]);

  const syncErp = useCallback(async (connectionId: string) => {
    if (!options.me) return;
    try {
      await api.syncErp(options.me.id, connectionId);
      setErpConnections((prev) =>
        prev.map((c) => c.id === connectionId ? { ...c, lastSyncAt: new Date().toISOString() } : c),
      );
      showToast("success", "Sincronização iniciada");
    } catch (err) {
      showToast("error", err instanceof Error ? err.message : "Erro ao sincronizar");
    }
  }, [api, options.me]);

  const connectCrm = useCallback(async (provider: string, credentials?: Record<string, string>) => {
    if (!options.me) return;
    try {
      const conn = await (api as any).connectCrm?.(options.me.id, provider, credentials);
      if (conn) setCrmConnections((prev) => [...prev.filter((c: any) => c.provider !== provider), conn]);
      showToast("success", `${provider} conectado`);
    } catch (err) {
      showToast("error", err instanceof Error ? err.message : `Erro ao conectar ${provider}`);
    }
  }, [api, options.me]);

  const disconnectCrm = useCallback(async (connectionId: string) => {
    if (!options.me) return;
    try {
      await (api as any).disconnectCrm?.(options.me.id, connectionId);
      setCrmConnections((prev) => prev.filter((c: any) => c.id !== connectionId));
      showToast("success", "CRM desconectado");
    } catch (err) {
      showToast("error", err instanceof Error ? err.message : "Erro ao desconectar");
    }
  }, [api, options.me]);

  const createItem = useCallback(async (input: {
    sku: string;
    productName: string;
    variantName?: string;
    locationId?: string;
    quantity: number;
    avgCostCents?: number;
    lowStockThreshold?: number;
  }) => {
    if (!options.me) return;
    try {
      const newItem = await api.createItem(options.me.id, input);
      setItems((prev) => [newItem, ...prev]);
      showToast("success", "Item criado com sucesso");
      return newItem;
    } catch (err) {
      showToast("error", err instanceof Error ? err.message : "Erro ao criar item");
      throw err;
    }
  }, [api, options.me]);

  return {
    summary,
    items,
    movements,
    alerts,
    locations,
    erpConnections,
    crmConnections,
    loading,
    error,
    loadData,
    // Pagination
    itemPage,
    setItemPage,
    movementPage,
    setMovementPage,
    pageSize,
    // Tab
    tab,
    setTab,
    // Actions
    acknowledgeAlert,
    recordMovement,
    createItem,
    connectErp,
    disconnectErp,
    syncErp,
    connectCrm,
    disconnectCrm,
  };
}
