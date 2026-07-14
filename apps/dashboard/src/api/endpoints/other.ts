import { dashboardJson } from "../http/client.js";
import {
  mapWebhookEndpoint,
  mapWebhookDelivery,
  type WebhookEndpointApi,
  type WebhookDeliveryApi,
} from "../adapters/webhook-mappers.js";
import type {
  MerchantApiKey,
  CreatedMerchantApiKey,
  WebhookEndpoint,
  WebhookDelivery,
  TenantOrder,
  TenantCustomer,
  TenantPayment,
  CursorPage,
  DashboardOverview,
  EmbedSessionResponse,
  OnboardingStateResponse,
  OnboardingStepId,
  BillingSubscription,
  BillingCheckoutSessionResponse,
  BillingPortalSessionResponse,
  PaymentConnection,
  PaymentOnboardingLinkResponse,
  AuditEvent,
  AgentRules,
  NegotiationPolicy,
  NegotiationPolicyResponse,
  NegotiationSession,
  NegotiationStats,
  NegotiationEvaluateBridgeResponse,
  CommerceConnection,
  CommerceConnectionTestResult,
  ConnectCommercePayload,
  Installation,
} from "../types.js";

export function otherEndpoints(base: string, f: typeof fetch) {
  return {
    // Integrations
    getIntegrationApiKeys(): Promise<MerchantApiKey[]> {
      return dashboardJson(base, "/integrations/api-keys", { method: "GET" }, f);
    },
    createIntegrationApiKey(payload: { name?: string; scopes?: string[] }): Promise<CreatedMerchantApiKey> {
      return dashboardJson(base, "/integrations/api-keys", { method: "POST", jsonBody: payload }, f);
    },
    revokeIntegrationApiKey(apiKeyId: string): Promise<MerchantApiKey> {
      return dashboardJson(base, `/integrations/api-keys/${encodeURIComponent(apiKeyId)}`, { method: "DELETE" }, f);
    },

    // Webhooks
    async getWebhookEndpoints(): Promise<WebhookEndpoint[]> {
      const page = await dashboardJson<CursorPage<WebhookEndpointApi>>(
        base,
        "/webhook-endpoints",
        { method: "GET" },
        f,
      );
      return page.data.map(mapWebhookEndpoint);
    },
    async createWebhookEndpoint(payload: { url: string; events?: string[]; enabled?: boolean; description?: string }): Promise<WebhookEndpoint> {
      return mapWebhookEndpoint(
        await dashboardJson<WebhookEndpointApi>(
          base,
          "/webhook-endpoints",
          { method: "POST", jsonBody: payload },
          f,
        ),
      );
    },
    async updateWebhookEndpoint(endpointId: string, payload: { url: string; events?: string[]; enabled?: boolean; description?: string }): Promise<WebhookEndpoint> {
      return mapWebhookEndpoint(
        await dashboardJson<WebhookEndpointApi>(
          base,
          `/webhook-endpoints/${encodeURIComponent(endpointId)}`,
          { method: "PUT", headers: { "If-Match": "*" }, jsonBody: payload },
          f,
        ),
      );
    },
    async testWebhookEndpoint(endpointId: string): Promise<WebhookDelivery> {
      return mapWebhookDelivery(
        await dashboardJson<WebhookDeliveryApi>(
          base,
          `/webhook-endpoints/${encodeURIComponent(endpointId)}/test`,
          { method: "POST" },
          f,
        ),
      );
    },
    async getWebhookDeliveries(limit?: number): Promise<WebhookDelivery[]> {
      const query = limit ? `?limit=${encodeURIComponent(String(limit))}` : "";
      const endpoints = (
        await dashboardJson<CursorPage<WebhookEndpointApi>>(
          base,
          "/webhook-endpoints",
          { method: "GET" },
          f,
        )
      ).data;
      const pages = await Promise.all(
        endpoints.map((endpoint) =>
          dashboardJson<CursorPage<WebhookDeliveryApi>>(
            base,
            `/webhook-endpoints/${encodeURIComponent(endpoint.id)}/deliveries${query}`,
            { method: "GET" },
            f,
          ),
        ),
      );
      return pages
        .flatMap((page) => page.data.map(mapWebhookDelivery))
        .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
    },
    async replayWebhookDelivery(endpointId: string, deliveryId: string): Promise<WebhookDelivery> {
      return mapWebhookDelivery(
        await dashboardJson<WebhookDeliveryApi>(
          base,
          `/webhook-endpoints/${encodeURIComponent(endpointId)}/deliveries/${encodeURIComponent(deliveryId)}/replay`,
          { method: "POST" },
          f,
        ),
      );
    },

    // Orders
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

    // Customers
    async getCustomers(limit?: number): Promise<TenantCustomer[]> {
      const query = limit ? `?limit=${encodeURIComponent(String(limit))}` : "";
      return (
        await dashboardJson<CursorPage<TenantCustomer>>(
          base,
          `/customers${query}`,
          { method: "GET" },
          f,
        )
      ).data;
    },
    async getCustomersPage(limit?: number, cursor?: string): Promise<CursorPage<TenantCustomer>> {
      const params = new URLSearchParams();
      if (limit) params.set("limit", String(limit));
      if (cursor) params.set("cursor", cursor);
      const query = params.toString() ? `?${params.toString()}` : "";
      return dashboardJson<CursorPage<TenantCustomer>>(
        base,
        `/customers${query}`,
        { method: "GET" },
        f,
      );
    },

    // Payments
    async getPayments(limit?: number): Promise<TenantPayment[]> {
      const query = limit ? `?limit=${encodeURIComponent(String(limit))}` : "";
      return (
        await dashboardJson<CursorPage<TenantPayment>>(
          base,
          `/payments${query}`,
          { method: "GET" },
          f,
        )
      ).data;
    },
    getDashboardOverview(merchantId: string): Promise<DashboardOverview> {
      return dashboardJson<DashboardOverview>(
        base,
        `/checkout/dashboard/overview/${encodeURIComponent(merchantId)}`,
        { method: "GET" },
        f,
      );
    },

    // Embed
    createEmbedSession(payload: {
      ttl_seconds?: number;
      allowed_origin?: string;
      scopes?: string[];
      cart_ref?: string;
    }): Promise<EmbedSessionResponse> {
      return dashboardJson(base, "/embed/sessions", { method: "POST", jsonBody: payload }, f);
    },

    // Onboarding
    getOnboardingState(): Promise<OnboardingStateResponse> {
      return dashboardJson(base, "/onboarding", { method: "GET" }, f);
    },
    completeOnboardingStep(step: OnboardingStepId): Promise<OnboardingStateResponse> {
      return dashboardJson(
        base,
        `/onboarding/steps/${encodeURIComponent(step)}/complete`,
        { method: "POST" },
        f
      );
    },

    // Billing
    getBillingSubscription(): Promise<BillingSubscription> {
      return dashboardJson(base, "/billing/subscription", { method: "GET" }, f);
    },
    createBillingCheckoutSession(payload: { price_id?: string; success_url?: string; cancel_url?: string }): Promise<BillingCheckoutSessionResponse> {
      return dashboardJson(base, "/billing/checkout-session", { method: "POST", jsonBody: payload }, f);
    },
    createBillingPortalSession(payload: { return_url?: string }): Promise<BillingPortalSessionResponse> {
      return dashboardJson(base, "/billing/portal-session", { method: "POST", jsonBody: payload }, f);
    },

    // Payment Connections
    async getPaymentConnections(): Promise<PaymentConnection[]> {
      const res = await dashboardJson<{ data: PaymentConnection[] } | PaymentConnection[]>(base, "/payments/connections", { method: "GET" }, f);
      return Array.isArray(res) ? res : (res?.data ?? []);
    },
    createStripeOnboardingLink(payload: { return_url?: string; refresh_url?: string }): Promise<PaymentOnboardingLinkResponse> {
      return dashboardJson(base, "/payments/connections/stripe/onboarding-link", { method: "POST", jsonBody: payload }, f);
    },
    syncStripeConnection(): Promise<PaymentConnection> {
      return dashboardJson(base, "/payments/connections/stripe/sync", { method: "POST" }, f);
    },
    connectAsaas(payload: { api_key: string }): Promise<PaymentConnection> {
      return dashboardJson(base, "/payments/connections/asaas", { method: "POST", jsonBody: payload }, f);
    },
    createAsaasOnboardingLink(payload: { return_url?: string }): Promise<PaymentOnboardingLinkResponse> {
      return dashboardJson(base, "/payments/connections/asaas/onboarding-link", { method: "POST", jsonBody: payload }, f);
    },
    syncAsaasConnection(): Promise<PaymentConnection> {
      return dashboardJson(base, "/payments/connections/asaas/sync", { method: "POST" }, f);
    },
    enableCryptoPayments(payload: { network: string; walletAddress: string }): Promise<{ success: boolean }> {
      return dashboardJson(base, "/merchant/crypto-payments/enable", { method: "POST", jsonBody: { merchantPublicKey: payload.walletAddress, merchantSecretKey: payload.network } }, f);
    },

    // Audit
    async getAuditEvents(options?: {
      limit?: number;
      cursor?: string;
    }): Promise<CursorPage<AuditEvent>> {
      const params = new URLSearchParams();
      if (options?.limit) params.set("limit", String(options.limit));
      if (options?.cursor) params.set("cursor", options.cursor);
      const query = params.toString() ? `?${params.toString()}` : "";
      return dashboardJson<CursorPage<AuditEvent>>(
        base,
        `/audit-events${query}`,
        { method: "GET" },
        f,
      );
    },

    // Agent Rules
    getAgentRules(): Promise<AgentRules> {
      return dashboardJson(base, "/agent-rules", { method: "GET" }, f);
    },
    putAgentRules(payload: AgentRules): Promise<AgentRules> {
      return dashboardJson(base, "/agent-rules", { method: "PUT", jsonBody: payload }, f);
    },
    getAgentRulesContext(): Promise<Record<string, unknown>> {
      return dashboardJson(base, "/agent-rules/context", { method: "GET" }, f);
    },

    // Negotiation
    getNegotiationPolicy(): Promise<NegotiationPolicyResponse> {
      return dashboardJson(base, "/merchant-negotiation-policy", { method: "GET" }, f);
    },
    putNegotiationPolicy(payload: NegotiationPolicy): Promise<NegotiationPolicyResponse> {
      return dashboardJson(base, "/merchant-negotiation-policy", { method: "PUT", jsonBody: payload }, f);
    },
    getNegotiationSessions(params?: { limit?: number; cursor?: string }): Promise<CursorPage<NegotiationSession>> {
      const query = new URLSearchParams();
      if (params?.limit) query.set("limit", String(params.limit));
      if (params?.cursor) query.set("cursor", params.cursor);
      const qs = query.toString();
      return dashboardJson(base, `/negotiations/sessions${qs ? `?${qs}` : ""}`, { method: "GET" }, f);
    },
    getNegotiationStats(period?: string): Promise<NegotiationStats> {
      const qs = period ? `?period=${encodeURIComponent(period)}` : "";
      return dashboardJson(base, `/negotiations/stats${qs}`, { method: "GET" }, f);
    },
    evaluateNegotiation(
      payload: Record<string, unknown>
    ): Promise<NegotiationEvaluateBridgeResponse> {
      return dashboardJson(base, "/negotiations/evaluate", { method: "POST", jsonBody: payload }, f);
    },

    // Commerce
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

    // Installations
    async getInstallations(): Promise<Installation[]> {
      const response = await dashboardJson<Installation[] | CursorPage<Installation>>(
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
