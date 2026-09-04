import { dashboardJson } from "../http/client.js";
import type {
  MarketplaceConfig,
  MarketplaceOrder,
  MarketplaceStats,
} from "../../pages/marketplace/types.js";

/** Maps API config response → dashboard MarketplaceConfig shape */
function mapConfigResponse(raw: any): MarketplaceConfig {
  return {
    id: raw.id ?? "",
    merchant_id: raw.merchant_id ?? "",
    enabled: raw.enabled ?? false,
    commission_percent: raw.commission_rate_bps != null
      ? Math.round(raw.commission_rate_bps / 100)
      : (raw.commission_percent ?? 15),
    return_window_days: raw.return_window_days ?? 7,
    settlement_window_days: raw.payout_delay_days ?? raw.settlement_window_days ?? 14,
    chargeback_window_days: raw.chargeback_window_days ?? 30,
    blocked_merchant_ids: raw.blocked_merchants ?? raw.blocked_merchant_ids ?? [],
    created_at: raw.created_at ?? "",
    updated_at: raw.updated_at ?? "",
  };
}

/** Maps dashboard config update → API payload shape */
function mapConfigPayload(payload: Partial<Pick<MarketplaceConfig, "enabled" | "commission_percent" | "return_window_days" | "settlement_window_days" | "chargeback_window_days" | "blocked_merchant_ids">>) {
  const mapped: Record<string, unknown> = {};
  if (payload.enabled != null) mapped.enabled = payload.enabled;
  if (payload.commission_percent != null) mapped.commission_rate_bps = payload.commission_percent * 100;
  if (payload.return_window_days != null) mapped.return_window_days = payload.return_window_days;
  if (payload.settlement_window_days != null) mapped.payout_delay_days = payload.settlement_window_days;
  if (payload.chargeback_window_days != null) mapped.chargeback_window_days = payload.chargeback_window_days;
  if (payload.blocked_merchant_ids != null) mapped.blocked_merchants = payload.blocked_merchant_ids;
  return mapped;
}

export function marketplaceEndpoints(base: string, f: typeof fetch) {
  return {
    async getMarketplaceConfig(): Promise<MarketplaceConfig> {
      const raw = await dashboardJson<any>(base, "/marketplace/dashboard/config", { method: "GET" }, f);
      return mapConfigResponse(raw);
    },

    async updateMarketplaceConfig(
      payload: Partial<Pick<MarketplaceConfig, "enabled" | "commission_percent" | "return_window_days" | "settlement_window_days" | "chargeback_window_days" | "blocked_merchant_ids">>
    ): Promise<MarketplaceConfig> {
      const raw = await dashboardJson<any>(base, "/marketplace/dashboard/config", { method: "PATCH", jsonBody: mapConfigPayload(payload) }, f);
      return mapConfigResponse(raw);
    },

    async getMarketplaceOrders(): Promise<MarketplaceOrder[]> {
      const raw = await dashboardJson<any>(base, "/marketplace/dashboard/orders", { method: "GET" }, f);
      // API returns { orders: [...] } or array directly
      const list = Array.isArray(raw) ? raw : (raw?.orders ?? []);
      return list;
    },

    async getMarketplaceStats(): Promise<MarketplaceStats> {
      const raw = await dashboardJson<any>(base, "/marketplace/dashboard/stats", { method: "GET" }, f);
      return {
        pending_orders: raw.pendingOrders ?? raw.pending_orders ?? 0,
        monthly_revenue: raw.monthlyRevenueCents != null
          ? raw.monthlyRevenueCents / 100
          : (raw.monthly_revenue ?? 0),
        items_shipped: raw.itemsShipped ?? raw.items_shipped ?? 0,
        fulfillment_rate: raw.fulfillmentRate ?? raw.fulfillment_rate ?? 0,
      };
    },

    markMarketplaceItemShipped(lineItemId: string, trackingNumber: string): Promise<void> {
      return dashboardJson(
        base,
        `/marketplace/orders/line-items/${encodeURIComponent(lineItemId)}/ship`,
        { method: "POST", jsonBody: { tracking_number: trackingNumber } },
        f
      );
    },

    markMarketplaceItemDelivered(lineItemId: string): Promise<void> {
      return dashboardJson(
        base,
        `/marketplace/orders/line-items/${encodeURIComponent(lineItemId)}/deliver`,
        { method: "POST" },
        f
      );
    },
  };
}
