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
    listCoupons(): Promise<Array<{ id: string; code: string; type: string; value: number; isActive: boolean }>> {
      return dashboardJson(base, "/merchant/coupons", { method: "GET" }, f);
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
