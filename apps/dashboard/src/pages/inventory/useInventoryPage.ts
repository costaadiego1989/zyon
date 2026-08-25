import { useState, useEffect, useCallback } from "react";
import type { MerchantProfile } from "../../api-client.js";
import { showToast } from "../../components/Toast.js";

export function useInventoryPage(options: {
  me: MerchantProfile | null;
  api?: any;
}) {
  const [summary, setSummary] = useState<any>(null);
  const [items, setItems] = useState<any[]>([]);
  const [movements, setMovements] = useState<any[]>([]);
  const [alerts, setAlerts] = useState<any[]>([]);
  const [locations, setLocations] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Pagination state
  const [itemPage, setItemPage] = useState(1);
  const [movementPage, setMovementPage] = useState(1);
  const pageSize = 10;

  // Tab state
  const [tab, setTab] = useState<"overview" | "movements" | "alerts" | "erp">("overview");

  const loadData = useCallback(async () => {
    if (!options.api || !options.me) return;

    try {
      setLoading(true);
      setError(null);
      const [sum, itemList, moveList, alertList, locList] = await Promise.all([
        options.api.getInventorySummary(options.me.id),
        options.api.listInventoryItems(options.me.id, { pageSize: 50 }),
        options.api.listMovements(options.me.id, { pageSize: 50 }),
        options.api.listAlerts(options.me.id, false),
        options.api.listLocations(options.me.id),
      ]).catch((err) => {
        setError(err?.message ?? "Erro ao carregar estoque");
        return [null, null, null, null, null];
      });

      setSummary(sum ?? null);
      setItems(itemList?.items ?? []);
      setMovements(moveList?.movements ?? []);
      setAlerts(alertList ?? []);
      setLocations(locList ?? []);
    } finally {
      setLoading(false);
    }
  }, [options.api, options.me]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const acknowledgeAlert = useCallback(async (alertId: string) => {
    if (!options.api || !options.me) return;
    try {
      await options.api.acknowledgeAlert(options.me.id, alertId);
      setAlerts((prev) =>
        prev.map((a) =>
          a.id === alertId ? { ...a, acknowledged_at: new Date().toISOString() } : a,
        ),
      );
      showToast("success", "Alerta reconhecido");
    } catch (err) {
      showToast("error", err instanceof Error ? err.message : "Erro ao reconhecer alerta");
    }
  }, [options.api, options.me]);

  const recordMovement = useCallback(async (input: {
    sku: string;
    kind: string;
    quantity: number;
    reason?: string;
  }) => {
    if (!options.api || !options.me) return;
    try {
      await options.api.recordMovement(options.me.id, input);
      showToast("success", "Movimentação registrada");
      await loadData();
    } catch (err) {
      showToast("error", err instanceof Error ? err.message : "Erro ao registrar movimentação");
    }
  }, [options.api, options.me, loadData]);

  return {
    summary,
    items,
    movements,
    alerts,
    locations,
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
  };
}
