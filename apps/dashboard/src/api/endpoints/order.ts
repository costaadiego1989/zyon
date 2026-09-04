import { dashboardJson } from "../http/client.js";
import type { TenantOrder, CursorPage } from "../types.js";

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
    purchaseShippingLabel(payload: {
      order_id: string;
      service_id: number;
      from_zip: string;
      to_zip: string;
      to_name: string;
      to_document: string;
      packages: Array<{ weightKg: number; widthCm: number; heightCm: number; lengthCm: number; quantity: number }>;
      invoice_key?: string;
    }): Promise<unknown> {
      return dashboardJson(base, "/shipping/labels", { method: "POST", jsonBody: payload }, f);
    },
  };
}