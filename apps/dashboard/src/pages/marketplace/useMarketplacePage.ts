import { useCallback, useEffect, useState } from "react";
import { showToast } from "../../components/Toast.js";
import { useApi } from "../../hooks/useApi.js";
import type { MerchantProfile } from "../../api-client.js";
import type { MarketplaceConfig, MarketplaceOrder, MarketplaceStats } from "./types.js";

export type MarketplaceTab = "settings" | "orders";

export function useMarketplacePage(me: MerchantProfile | null) {
  const api = useApi();

  const [tab, setTab] = useState<MarketplaceTab>("settings");
  const [config, setConfig] = useState<MarketplaceConfig | null>(null);
  const [orders, setOrders] = useState<MarketplaceOrder[]>([]);
  const [stats, setStats] = useState<MarketplaceStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const loadConfig = useCallback(async () => {
    try {
      const cfg = await api.getMarketplaceConfig();
      setConfig(cfg);
    } catch {
      setConfig(null);
    }
  }, [api]);

  const loadOrders = useCallback(async () => {
    try {
      const [orderList, orderStats] = await Promise.all([
        api.getMarketplaceOrders(),
        api.getMarketplaceStats(),
      ]);
      setOrders(orderList);
      setStats(orderStats);
    } catch {
      setOrders([]);
      setStats(null);
    }
  }, [api]);

  useEffect(() => {
    if (!me) {
      setConfig(null);
      setOrders([]);
      setStats(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    Promise.all([loadConfig(), loadOrders()]).finally(() => setLoading(false));
  }, [me, loadConfig, loadOrders]);

  async function saveConfig(updates: Partial<MarketplaceConfig>) {
    setSaving(true);
    try {
      const updated = await api.updateMarketplaceConfig(updates);
      setConfig(updated);
      showToast("success", "Configurações salvas");
    } catch {
      showToast("error", "Erro ao salvar configurações");
    } finally {
      setSaving(false);
    }
  }

  async function markShipped(lineItemId: string, trackingNumber: string) {
    try {
      await api.markMarketplaceItemShipped(lineItemId, trackingNumber);
      showToast("success", "Item marcado como enviado");
      await loadOrders();
    } catch {
      showToast("error", "Erro ao marcar item como enviado");
    }
  }

  async function markDelivered(lineItemId: string) {
    try {
      await api.markMarketplaceItemDelivered(lineItemId);
      showToast("success", "Item marcado como entregue");
      await loadOrders();
    } catch {
      showToast("error", "Erro ao marcar item como entregue");
    }
  }

  return {
    state: { config, orders, stats, loading, saving, tab },
    actions: { saveConfig, markShipped, markDelivered, setTab },
  };
}
