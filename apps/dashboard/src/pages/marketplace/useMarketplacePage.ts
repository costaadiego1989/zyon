import { useCallback, useEffect, useState } from "react";
import { showToast } from "../../components/Toast.js";
import { useApi } from "../../hooks/useApi.js";
import type { MerchantProfile } from "../../api-client.js";
import type { MarketplaceConfig, MarketplaceOrder, MarketplaceStats } from "./types.js";
import type { MarketplaceSettlement } from "../../api/endpoints/marketplace-v2.js";

export type MarketplaceTab = "settings" | "orders" | "settlements" | "chargebacks";

const DEFAULT_CONFIG: MarketplaceConfig = {
  enabled: false,
  commission_percent: 15,
  return_window_days: 7,
  settlement_window_days: 14,
  chargeback_window_days: 30,
  blocked_merchant_ids: [],
};

const DEFAULT_STATS: MarketplaceStats = {
  pending_orders: 0,
  monthly_revenue: 0,
  items_shipped: 0,
  fulfillment_rate: 0,
};

export function useMarketplacePage(me: MerchantProfile | null) {
  const api = useApi();

  const [tab, setTab] = useState<MarketplaceTab>("orders");
  const [config, setConfig] = useState<MarketplaceConfig>(DEFAULT_CONFIG);
  const [orders, setOrders] = useState<MarketplaceOrder[]>([]);
  const [stats, setStats] = useState<MarketplaceStats>(DEFAULT_STATS);
  const [settlements, setSettlements] = useState<MarketplaceSettlement[]>([]);
  const [selectedSettlementId, setSelectedSettlementId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const loadConfig = useCallback(async () => {
    try {
      const cfg = await api.getMarketplaceConfig();
      if (cfg) setConfig(cfg);
    } catch {
      // Use default config — endpoint may not be reachable yet
    }
  }, [api]);

  const loadOrders = useCallback(async () => {
    try {
      const [orderList, orderStats] = await Promise.all([
        api.getMarketplaceOrders(),
        api.getMarketplaceStats(),
      ]);
      if (Array.isArray(orderList)) setOrders(orderList);
      else if (orderList && Array.isArray((orderList as any).orders)) setOrders((orderList as any).orders);
      if (orderStats) setStats(orderStats);
    } catch {
      // Use defaults
    }
  }, [api]);

  const loadSettlements = useCallback(async () => {
    try {
      const res = await api.getMarketplaceSettlements?.();
      if (res && Array.isArray(res.settlements)) {
        setSettlements(res.settlements);
      }
    } catch {
      // Settlements endpoint may not exist yet
    }
  }, [api]);

  useEffect(() => {
    if (!me) {
      setConfig(DEFAULT_CONFIG);
      setOrders([]);
      setStats(DEFAULT_STATS);
      setSettlements([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    Promise.all([loadConfig(), loadOrders(), loadSettlements()]).finally(() => setLoading(false));
  }, [me, loadConfig, loadOrders, loadSettlements]);

  async function saveConfig(updates: Partial<MarketplaceConfig>) {
    const previous = config;
    const merged = { ...config, ...updates };
    setConfig(merged);
    setSaving(true);
    try {
      await api.updateMarketplaceConfig(updates);
      showToast("success", "Configurações salvas");
    } catch {
      setConfig(previous);
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
    state: { config, orders, stats, loading, saving, tab, settlements, selectedSettlementId },
    actions: { saveConfig, markShipped, markDelivered, setTab, setSelectedSettlementId },
  };
}
