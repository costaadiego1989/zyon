import { dashboardJson } from "../http/client.js";
import type { TenantOrder, TenantOrderDetail, CursorPage } from "../types.js";

export function orderEndpoints(base: string, f: typeof fetch) {
  return {
    async getOrders(limit?: number, cursor?: string): Promise<CursorPage<TenantOrder>> {
      const params = new URLSearchParams();
      if (limit) params.set("limit", String(limit));
      if (cursor) params.set("cursor", cursor);
      const query = params.toString() ? `?${params.toString()}` : "";
      return dashboardJson<CursorPage<TenantOrder>>(
        base,
        `/orders${query}`,
        { method: "GET" },
        f,
      );
    },
    getOrderDetail(orderId: string): Promise<TenantOrderDetail> {
      return dashboardJson<TenantOrderDetail>(
        base,
        `/orders/${encodeURIComponent(orderId)}`,
        { method: "GET" },
        f,
      );
    },
    updateOrderTracking(orderId: string, payload: { tracking_code: string; carrier?: string; tracking_url?: string; status?: string }): Promise<unknown> {
      return dashboardJson(
        base,
        `/orders/${encodeURIComponent(orderId)}/tracking`,
        { method: "PUT", jsonBody: payload },
        f,
      );
    },
    updateOrderStatus(orderId: string, status: string): Promise<unknown> {
      return dashboardJson(
        base,
        `/orders/${encodeURIComponent(orderId)}/status`,
        { method: "PUT", jsonBody: { status } },
        f,
      );
    },
    cancelOrder(orderId: string, payload: { reason: string; notify_customer?: boolean; restock?: boolean }): Promise<unknown> {
      return dashboardJson(
        base,
        `/orders/${encodeURIComponent(orderId)}/cancel`,
        { method: "POST", jsonBody: payload },
        f,
      );
    },
  };
}
