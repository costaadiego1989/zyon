import { dashboardJson } from "../http/client.js";
import type {
  MarketplaceConfig,
  MarketplaceOrder,
  MarketplaceStats,
} from "../../pages/marketplace/types.js";

export function marketplaceEndpoints(base: string, f: typeof fetch) {
  return {
    getMarketplaceConfig(): Promise<MarketplaceConfig> {
      return dashboardJson(base, "/marketplace/config", { method: "GET" }, f);
    },

    updateMarketplaceConfig(
      payload: Partial<Pick<MarketplaceConfig, "enabled" | "commission_percent" | "return_window_days" | "settlement_window_days" | "chargeback_window_days" | "blocked_merchant_ids">>
    ): Promise<MarketplaceConfig> {
      return dashboardJson(base, "/marketplace/config", { method: "PATCH", jsonBody: payload }, f);
    },

    getMarketplaceOrders(): Promise<MarketplaceOrder[]> {
      return dashboardJson(base, "/marketplace/orders", { method: "GET" }, f);
    },

    getMarketplaceStats(): Promise<MarketplaceStats> {
      return dashboardJson(base, "/marketplace/stats", { method: "GET" }, f);
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
