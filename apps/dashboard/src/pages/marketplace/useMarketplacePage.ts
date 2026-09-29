import { useCallback, useEffect, useState, useRef } from "react";
import { showToast } from "../../components/Toast.js";
import { useApi } from "../../hooks/useApi.js";
import { reportError } from "../../lib/observability/error-reporter.js";
import type { MerchantProfile } from "../../api-client.js";
import type { MarketplaceConfig, MarketplaceOrder, MarketplaceStats } from "./types.js";
import type { MarketplaceSettlement, MarketplaceSellerDebt } from "../../api/endpoints/marketplace-v2.js";

export type MarketplaceTab = "stores" | "settings" | "orders" | "settlements" | "returns" | "chargebacks";

export interface ChargebackEntry {
  settlement: MarketplaceSettlement;
  debt: MarketplaceSellerDebt | null;
  type: "chargeback_cancelled" | "chargeback_debt";
}

const DEFAULT_CONFIG: MarketplaceConfig = {
  id: "",
  merchant_id: "",
  enabled: false,
  commission_percent: 15,
  return_window_days: 7,
  settlement_window_days: 14,
  chargeback_window_days: 30,
  blocked_merchant_ids: [],
  created_at: "",
  updated_at: "",
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
  const [chargebacks, setChargebacks] = useState<ChargebackEntry[]>([]);
  const [chargebackStats, setChargebackStats] = useState({
    totalDebtCents: 0,
    totalCancelled: 0,
    totalWithDebt: 0,
  });
  const [selectedSettlementId, setSelectedSettlementId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [errors, setErrors] = useState<Record<string, string>>({});
  const [actionError, setActionError] = useState<string | null>(null);
  const working = useRef(false);
  const errorFor = (key: string, value: string) => setErrors((prev) => ({ ...prev, [key]: value }));
  const loadConfig = useCallback(async () => {
    errorFor("settings", "");
    try {
      const cfg = await api.getMarketplaceConfig();
      if (cfg) setConfig(cfg);
    } catch (err) {
      errorFor("settings", "Não foi possível carregar esta seção. Tente novamente.");
      reportError({ source: "marketplace.loadConfig", error: err, severity: "warning" });
    }
  }, [api]);

  const loadOrders = useCallback(async () => {
    errorFor("orders", "");
    try {
      const [orderList, orderStats] = await Promise.all([
        api.getMarketplaceOrders(),
        api.getMarketplaceStats(),
      ]);
      // Backend returns FLAT cross-store line items (camelCase); the UI expects
      // grouped MarketplaceOrder rows with a snake_case line_items[] array. Normalize.
      const raw = Array.isArray(orderList)
        ? orderList
        : orderList && Array.isArray((orderList as any).orders)
        ? (orderList as any).orders
        : [];
      const normalized = raw.map((li: any) => {
        // Already grouped? keep as-is.
        if (Array.isArray(li.line_items)) return li;
        const statusMap: Record<string, string> = {
          fulfilled: "delivered",
          shipped: "shipped",
          pending: "pending",
          created: "pending",
        };
        const qty = li.quantity ?? 1;
        const unit = (li.unitPriceCents ?? 0) / 100;
        return {
          id: li.orderId ?? li.id,
          seller_merchant_id: li.sellerMerchantId,
          host_merchant_id: li.hostMerchantId,
          host_store_name: li.hostStoreName ?? li.host_store_name ?? li.hostMerchantId,
          total_amount: ((li.unitPriceCents ?? 0) * qty) / 100,
          status: statusMap[li.fulfillmentStatus] ?? "pending",
          created_at: li.createdAt ?? new Date().toISOString(),
          updated_at: li.updatedAt ?? new Date().toISOString(),
          line_items: [
            {
              id: li.id,
              order_id: li.orderId ?? li.id,
              product_id: li.federatedProductId ?? "",
              product_name: li.productName ?? li.federatedProductId ?? "Produto",
              quantity: qty,
              unit_price: unit,
              total_price: unit * qty,
              status: statusMap[li.fulfillmentStatus] ?? "pending",
              tracking_number: li.fulfillmentReference ?? undefined,
            },
          ],
        };
      });
      setOrders(normalized);
      if (orderStats) {
        const s = orderStats as any;
        // Backend stats are camelCase with cents; UI expects snake_case in reais.
        setStats({
          pending_orders: s.pending_orders ?? s.pendingOrders ?? 0,
          monthly_revenue: s.monthly_revenue ?? (s.monthlyRevenueCents ?? 0) / 100,
          items_shipped: s.items_shipped ?? s.itemsShipped ?? 0,
          fulfillment_rate: s.fulfillment_rate ?? s.fulfillmentRate ?? 0,
        });
      }
    } catch (err) {
      errorFor("orders", "Não foi possível carregar esta seção. Tente novamente.");
      reportError({ source: "marketplace.loadOrders", error: err, severity: "warning" });
    }
  }, [api]);

  const loadSettlements = useCallback(async () => {
    errorFor("settlements", "");
    try {
      const res = await api.getMarketplaceSettlements();
      if (res && Array.isArray(res.settlements)) {
        setSettlements(res.settlements);
      }
    } catch (err) {
      errorFor("settlements", "Não foi possível carregar esta seção. Tente novamente.");
      reportError({ source: "marketplace.loadSettlements", error: err, severity: "warning" });
    }
  }, [api]);

  const loadChargebacks = useCallback(async () => {
    errorFor("chargebacks", "");
    try {
      const res = await api.getMarketplaceChargebacks();
      if (res && Array.isArray(res.chargebacks)) {
        setChargebacks(res.chargebacks);
        setChargebackStats({
          totalDebtCents: res.totalDebtCents ?? 0,
          totalCancelled: res.totalCancelled ?? 0,
          totalWithDebt: res.totalWithDebt ?? 0,
        });
      }
    } catch (err) {
      errorFor("chargebacks", "Não foi possível carregar esta seção. Tente novamente.");
      reportError({ source: "marketplace.loadChargebacks", error: err, severity: "warning" });
    }
  }, [api]);

  useEffect(() => {
    if (!me) {
      setConfig(DEFAULT_CONFIG);
      setOrders([]);
      setStats(DEFAULT_STATS);
      setSettlements([]);
      setChargebacks([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    Promise.all([loadConfig(), loadOrders(), loadSettlements(), loadChargebacks()]).finally(() =>
      setLoading(false)
    );
  }, [me, loadConfig, loadOrders, loadSettlements, loadChargebacks]);

  async function saveConfig(updates: Partial<MarketplaceConfig>) {
    if (working.current || errors.settings) return false;
    working.current = true;
    setSaving(true);
    setActionError(null);
    try {
      const saved = await api.updateMarketplaceConfig(updates);
      setConfig(saved);
      showToast("success", "Configurações salvas");
      return true;
    } catch {
      setActionError("Não foi possível salvar. Suas alterações foram preservadas para tentar novamente.");
      return false;
    } finally {
      working.current = false;
      setSaving(false);
    }
  }
  async function markShipped(lineItemId: string, trackingNumber: string) {
    if (working.current) return false;
    working.current = true;
    setSaving(true);
    setActionError(null);
    try {
      await api.markMarketplaceItemShipped(lineItemId, trackingNumber);
      showToast("success", "Envio registrado");
      await loadOrders();
      return true;
    } catch {
      setActionError("Não foi possível registrar o envio. Confira o rastreamento e tente novamente.");
      return false;
    } finally {
      working.current = false;
      setSaving(false);
    }
  }
  async function markDelivered(lineItemId: string) {
    if (working.current) return false;
    working.current = true;
    setSaving(true);
    setActionError(null);
    try {
      await api.markMarketplaceItemDelivered(lineItemId);
      showToast("success", "Entrega registrada");
      await loadOrders();
      return true;
    } catch {
      setActionError("Não foi possível registrar a entrega. Tente novamente.");
      return false;
    } finally {
      working.current = false;
      setSaving(false);
    }
  }
  async function retrySection() {
    setLoading(true);
    try {
      if (tab === "settings") await loadConfig();
      else if (tab === "orders") await loadOrders();
      else if (tab === "settlements" || tab === "returns") await loadSettlements();
      else if (tab === "chargebacks") await loadChargebacks();
    } finally {
      setLoading(false);
    }
  }
  return {
    state: {
      config,
      orders,
      stats,
      loading,
      saving,
      tab,
      settlements,
      chargebacks,
      chargebackStats,
      selectedSettlementId,
      errors,
      actionError,
    },
    actions: {
      saveConfig,
      markShipped,
      markDelivered,
      setTab,
      setSelectedSettlementId,
      retrySection,
      clearActionError: () => setActionError(null),
    },
  };
}
