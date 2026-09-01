import { dashboardJson } from "../http/client.js";
import type {
  MerchantApiKey,
  CreatedMerchantApiKey,
  CommerceConnection,
  CommerceConnectionTestResult,
  ConnectCommercePayload,
  Installation,
  CursorPage,
} from "../types.js";

export function integrationEndpoints(base: string, f: typeof fetch) {
  return {
    getIntegrationApiKeys(): Promise<MerchantApiKey[]> {
      return dashboardJson(base, "/integrations/api-keys", { method: "GET" }, f);
    },
    createIntegrationApiKey(payload: { name?: string; scopes?: string[] }): Promise<CreatedMerchantApiKey> {
      return dashboardJson(base, "/integrations/api-keys", { method: "POST", jsonBody: payload }, f);
    },
    revokeIntegrationApiKey(apiKeyId: string): Promise<MerchantApiKey> {
      return dashboardJson(base, `/integrations/api-keys/${encodeURIComponent(apiKeyId)}`, { method: "DELETE" }, f);
    },

    // Test seed
    seedTestData(): Promise<{ merchantId: string; embedToken: string; accessToken: string; productId: string }> {
      return dashboardJson(base, "/__test__/seed", { method: "POST" }, f);
    },

    // Coupons
    async listCoupons(): Promise<Array<{ id: string; code: string; type: string; value: number; isActive: boolean }>> {
      const raw = await dashboardJson<any[]>(base, "/merchant/coupons", { method: "GET" }, f);
      return (raw ?? []).map((c: any) => ({
        id: c.id,
        code: c.code,
        type: c.discount_type ?? c.discountType ?? c.type ?? "percent",
        value: c.discount_value ?? c.discountValue ?? c.value ?? 0,
        isActive: c.status === "active" || c.is_active === true || c.isActive === true,
      }));
    },
    createCoupon(payload: { code: string; discount_type: string; discount_value: number; min_cart_value?: number; max_uses?: number; starts_at?: string; expires_at?: string; product_id?: string; category_id?: string; is_active?: boolean }): Promise<unknown> {
      // Boundary mapping: the dashboard form uses UI-oriented field names, but the
      // API CreateCouponUseCase expects canonical domain names. Without this the
      // min-cart / usage-limit / expiry fields were silently dropped, deceiving the
      // merchant (a coupon they configured as limited persisted as unlimited).
      // The API discount-type enum is shipping_free (not free_shipping).
      const discount_type = payload.discount_type === "free_shipping" ? "shipping_free" : payload.discount_type;
      const body: Record<string, unknown> = {
        code: payload.code,
        discount_type,
        discount_value: payload.discount_value,
        starts_at: payload.starts_at,
        is_active: payload.is_active,
      };
      if (payload.min_cart_value !== undefined) body.min_cart_total = payload.min_cart_value;
      if (payload.max_uses !== undefined) body.max_usages = payload.max_uses;
      if (payload.expires_at !== undefined) body.ends_at = payload.expires_at;
      // NOTE: product_id / category_id restrictions are NOT yet supported by the
      // coupon API (it exposes allowed_skus/allowed_regions only, and a product id
      // is not a sku). Dropping them here rather than mapping to the wrong field.
      return dashboardJson(base, "/merchant/coupons", { method: "POST", jsonBody: body }, f);
    },
    deleteCoupon(id: string): Promise<unknown> {
      return dashboardJson(base, `/merchant/coupons/${encodeURIComponent(id)}`, { method: "DELETE" }, f);
    },
    toggleCoupon(id: string, isActive: boolean): Promise<unknown> {
      return dashboardJson(base, `/merchant/coupons/${encodeURIComponent(id)}`, { method: "PATCH", jsonBody: { is_active: isActive } }, f);
    },

    // Budget Requests
    getBudgetRequests(merchantId: string): Promise<Array<{ id: string; status: string; [key: string]: unknown }>> {
      return dashboardJson(
        base,
        `/storefront/budget-requests?merchantId=${encodeURIComponent(merchantId)}`,
        { method: "GET" },
        f,
      );
    },
    updateBudgetRequestStatus(requestId: string, status: "approved" | "rejected"): Promise<unknown> {
      return dashboardJson(
        base,
        `/storefront/budget-requests/${encodeURIComponent(requestId)}/status`,
        { method: "POST", jsonBody: { status } },
        f,
      );
    },
  };
}

export function commerceEndpoints(base: string, f: typeof fetch) {
  return {
    async getCommerceConnections(): Promise<CommerceConnection[]> {
      const response = await dashboardJson<CommerceConnection[] | CursorPage<CommerceConnection>>(
        base,
        "/commerce/connections",
        { method: "GET" },
        f,
      );
      return Array.isArray(response) ? response : response.data;
    },
    createCommerceConnection(payload: ConnectCommercePayload): Promise<CommerceConnection> {
      return dashboardJson(base, "/commerce/connections", { method: "POST", jsonBody: payload }, f);
    },
    testCommerceConnection(): Promise<CommerceConnectionTestResult> {
      return dashboardJson(base, "/commerce/connections/test", { method: "POST" }, f);
    },
    syncCommerceConnection(): Promise<CommerceConnection> {
      return dashboardJson(base, "/commerce/connections/sync", { method: "POST" }, f);
    },
    deleteCommerceConnection(): Promise<{ disconnected: boolean }> {
      return dashboardJson(base, "/commerce/connections", { method: "DELETE" }, f);
    },
  };
}

export function installationEndpoints(base: string, f: typeof fetch) {
  return {
    async getInstallations(): Promise<Installation[]> {
      const response = await dashboardJson<Installation[] | { data: Installation[] }>(
        base,
        "/installations",
        { method: "GET" },
        f,
      );
      return Array.isArray(response) ? response : response.data;
    },
    getInstallation(installationId: string): Promise<Installation> {
      return dashboardJson(base, `/installations/${encodeURIComponent(installationId)}`, { method: "GET" }, f);
    },
    checkInstallationHealth(installationId: string): Promise<{ status: string; checks?: Record<string, unknown> }> {
      return dashboardJson(base, `/installations/${encodeURIComponent(installationId)}/health`, { method: "GET" }, f);
    },
  };
}
