import type {
  CheckoutSettings,
  CheckoutSettingsPatch,
  MerchantRules,
  MerchantTheme,
  OnboardingStateResponse,
  OnboardingStepId,
  SupportSettings,
  SupportSettingsPatch,
  SupportTicket,
  SupportTicketStatus,
  SupportTicketStatusPatch,
} from "@zyon/shared-types";

export type { OnboardingStateResponse, OnboardingStepId } from "@zyon/shared-types";

export function normalizeApiBase(url: string): string {
  return url.trimEnd().replace(/\/+$/, "");
}

export class DashboardHttpError extends Error {
  readonly name = "DashboardHttpError";

  constructor(
    readonly status: number,
    readonly responseBody: string
  ) {
    super(`dashboard_http_${status}`);
  }
}

function mergePath(urlPath: string): string {
  const trimmed = urlPath.trim().replace(/^\/+/, "");
  return `/${trimmed}`;
}

function versionedPath(path: string): string {
  const normalized = mergePath(path);
  return normalized === "/v1" || normalized.startsWith("/v1/")
    ? normalized
    : `/v1${normalized}`;
}

function mergeUrl(baseUrl: string, path: string): string {
  const base = normalizeApiBase(baseUrl);
  const normalizedPath = versionedPath(path);
  return base.endsWith("/v1")
    ? `${base}${normalizedPath.slice(3)}`
    : `${base}${normalizedPath}`;
}

export type DashboardLoginAuth = {
  merchant_id: string;
  user_id: string;
  email: string;
  access_token: string;
  token_type: "Bearer";
  expires_in: number;
};

export type DashboardRegisterPayload = {
  merchant_name: string;
  email: string;
  password: string;
  merchant_id?: string;
};

export type MerchantProfile = {
  id: string;
  name: string;
};

export type NegotiationEvaluateBridgeResponse = Record<string, unknown> & {
  negotiation_session_id?: string;
};

export type MerchantApiKey = {
  id: string;
  name: string;
  keyPrefix: string;
  scopes: string[];
  createdAt: string;
  lastUsedAt?: string;
  revokedAt?: string;
};

export type CreatedMerchantApiKey = {
  api_key: MerchantApiKey;
  secret_key: string;
};

export type WebhookEndpoint = {
  id: string;
  url: string;
  enabled: boolean;
  events: string[];
  description?: string;
  createdAt: string;
  updatedAt: string;
  signingSecret?: string;
  signingSecretHint?: string;
};

export type WebhookDelivery = {
  id: string;
  endpointId: string;
  endpointUrl: string;
  eventId: string;
  eventType: string;
  status: "pending" | "delivered" | "failed";
  attempts: number;
  nextAttemptAt?: string;
  responseStatus?: number;
  responseBody?: string;
  error?: string;
  createdAt: string;
  updatedAt: string;
  deliveredAt?: string;
};

export type TenantOrder = {
  id: string;
  session_id: string;
  external_order_id: string;
  status: "approved" | "cancelled";
  total: number;
  currency: string;
  tracking_code: string | null;
  customer: Record<string, unknown> | null;
  cart: Record<string, unknown>;
  completed_at: string;
  cancelled_at: string | null;
  cancellation_reason: string | null;
};

export type TenantCustomer = {
  id: string;
  profile: Record<string, unknown>;
  first_seen_at: string;
  last_seen_at: string;
};

export type TenantPayment = {
  id: string;
  session_id: string;
  amount: number;
  approved_amount: number | null;
  currency: string;
  method: string;
  status: string;
  provider_reference: string | null;
  commerce_order_id: string | null;
  created_at: string;
  updated_at: string;
};

export type BillingSubscription = {
  plan: string;
  status: string;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
  trial_end: string | null;
};

export type BillingCheckoutSessionResponse = {
  url: string;
};

export type BillingPortalSessionResponse = {
  url: string;
};

export type PaymentConnection = {
  id: string;
  provider: "stripe" | "asaas" | string;
  status: "active" | "pending" | "error" | string;
  account_id: string | null;
  created_at: string;
  updated_at: string;
};

export type PaymentOnboardingLinkResponse = {
  url: string;
};

export type AuditEvent = {
  id: string;
  merchant_id: string;
  actor_id: string | null;
  action: string;
  resource_type: string;
  resource_id: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
};

export type AgentRules = Record<string, unknown> & {
  enabled?: boolean;
};

export type NegotiationPolicy = Record<string, unknown> & {
  enabled?: boolean;
  max_discount_pct?: number;
};

export type CommerceConnection = {
  id: string;
  platform: string;
  shop_domain: string | null;
  status: "active" | "inactive" | "error" | string;
  created_at: string;
  updated_at: string;
};

export type Installation = {
  id: string;
  name: string | null;
  platform: string | null;
  status: "active" | "inactive" | string;
  health: "healthy" | "degraded" | "unknown" | string | null;
  created_at: string;
  updated_at: string;
};

type CursorPage<T> = {
  data: T[];
  next_cursor: string | null;
  has_more: boolean;
};

export type EmbedSessionResponse = {
  embed_session_token: string;
  expires_at_unix: number;
};

export async function dashboardFetch(
  apiBaseUrl: string,
  path: string,
  init: Omit<RequestInit, "credentials"> & { jsonBody?: unknown } = {},
  fetchImpl: typeof fetch = globalThis.fetch
): Promise<Response> {
  const { jsonBody, body, headers: headersInit, ...rest } = init;
  const headers = new Headers(headersInit ?? undefined);

  let finalBody = body ?? null;
  if (jsonBody !== undefined) {
    headers.set("Content-Type", "application/json");
    finalBody = JSON.stringify(jsonBody);
  }
  const method = (rest.method ?? "GET").toUpperCase();
  if (
    ["POST", "PUT", "PATCH", "DELETE"].includes(method) &&
    !path.includes("/auth/") &&
    !headers.has("Idempotency-Key")
  ) {
    headers.set("Idempotency-Key", createIdempotencyKey());
  }

  const doFetch = () =>
    fetchImpl(mergeUrl(apiBaseUrl, path), {
      ...rest,
      headers,
      body: finalBody,
      credentials: "include"
    });

  const res = await doFetch();

  if (res.status === 401 && !path.includes("/auth/")) {
    const refreshed = await silentRefresh(apiBaseUrl, fetchImpl);
    if (refreshed) {
      const retryRes = await doFetch();
      if (retryRes.status === 401) {
        emitSessionExpired();
      }
      return retryRes;
    }
    emitSessionExpired();
  }

  return res;
}

let refreshInFlight: Promise<boolean> | null = null;

async function silentRefresh(apiBaseUrl: string, fetchImpl: typeof fetch): Promise<boolean> {
  if (refreshInFlight) return refreshInFlight;

  refreshInFlight = (async () => {
    try {
      const res = await fetchImpl(mergeUrl(apiBaseUrl, "/auth/refresh"), {
        method: "POST",
        credentials: "include"
      });
      return res.ok;
    } catch {
      return false;
    } finally {
      refreshInFlight = null;
    }
  })();

  return refreshInFlight;
}

export const SESSION_EXPIRED_EVENT = "aacp:session_expired";

function emitSessionExpired() {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(SESSION_EXPIRED_EVENT));
  }
}

export async function dashboardJson<T>(
  apiBaseUrl: string,
  path: string,
  init: Omit<RequestInit, "credentials"> & { jsonBody?: unknown } = {},
  fetchImpl?: typeof fetch
): Promise<T> {
  const res = await dashboardFetch(apiBaseUrl, path, init, fetchImpl);
  const text = await res.text();
  if (!res.ok) {
    if (res.status === 401) {
      emitSessionExpired();
    }
    throw new DashboardHttpError(res.status, text);
  }
  return text === "" ? ({} as T) : (JSON.parse(text) as T);
}

export function createDashboardApi(options: {
  baseUrl: string;
  fetchImpl?: typeof fetch;
}) {
  const base = normalizeApiBase(options.baseUrl);
  const f = options.fetchImpl ?? globalThis.fetch;

  return {
    login(email: string, password: string): Promise<DashboardLoginAuth> {
      return dashboardJson<DashboardLoginAuth>(
        base,
        "/auth/login",
        {
          method: "POST",
          jsonBody: { email, password }
        },
        f
      );
    },

    register(payload: DashboardRegisterPayload): Promise<DashboardLoginAuth> {
      return dashboardJson<DashboardLoginAuth>(
        base,
        "/auth/register",
        {
          method: "POST",
          jsonBody: payload
        },
        f
      );
    },

    logout(): Promise<Record<string, never>> {
      return dashboardJson<Record<string, never>>(base, "/auth/logout", { method: "POST" }, f);
    },

    merchantProfile(): Promise<MerchantProfile> {
      return dashboardJson<MerchantProfile>(base, "/merchants/me", { method: "GET" }, f);
    },

    getMerchantRules(): Promise<MerchantRules> {
      return dashboardJson(base, "/merchants/me/rules", { method: "GET" }, f);
    },

    putMerchantRules(patch: Partial<MerchantRules>): Promise<MerchantRules> {
      return dashboardJson(base, "/merchants/me/rules", { method: "PUT", jsonBody: patch }, f);
    },

    getMerchantTheme(): Promise<MerchantTheme> {
      return dashboardJson(base, "/merchants/me/theme", { method: "GET" }, f);
    },

    putMerchantTheme(theme: MerchantTheme): Promise<MerchantTheme> {
      return dashboardJson(base, "/merchants/me/theme", { method: "PUT", jsonBody: theme }, f);
    },

    getCheckoutSettings(): Promise<CheckoutSettings> {
      return dashboardJson(base, "/checkout-settings", { method: "GET" }, f);
    },

    async patchCheckoutSettings(patch: CheckoutSettingsPatch): Promise<CheckoutSettings> {
      let ifMatchValue = "*";
      try {
        const getRes = await dashboardFetch(base, "/checkout-settings", { method: "GET" }, f);
        const etag = getRes.headers.get("etag");
        if (etag) ifMatchValue = etag;
      } catch {
        // ignore
      }
      return dashboardJson(base, "/checkout-settings", {
        method: "PUT",
        headers: { "If-Match": ifMatchValue },
        jsonBody: patch,
      }, f);
    },

    evaluateNegotiation(
      payload: Record<string, unknown>
    ): Promise<NegotiationEvaluateBridgeResponse> {
      return dashboardJson(base, "/negotiations/evaluate", { method: "POST", jsonBody: payload }, f);
    },

    getSupportSettings(): Promise<SupportSettings> {
      return dashboardJson(base, "/support/settings", { method: "GET" }, f);
    },

    putSupportSettings(patch: SupportSettingsPatch): Promise<SupportSettings> {
      return dashboardJson(base, "/support/settings", { method: "PUT", jsonBody: patch }, f);
    },

    async getSupportTickets(status?: SupportTicketStatus): Promise<SupportTicket[]> {
      const query = status ? `?status=${encodeURIComponent(status)}` : "";
      const response = await dashboardJson<
        SupportTicket[] | { data: SupportTicket[] }
      >(base, `/support/tickets${query}`, { method: "GET" }, f);
      return Array.isArray(response) ? response : response.data;
    },

    patchSupportTicketStatus(
      ticketId: string,
      status: SupportTicketStatus
    ): Promise<SupportTicket> {
      const patch: SupportTicketStatusPatch = { status };
      return dashboardJson(
        base,
        `/support/tickets/${encodeURIComponent(ticketId)}`,
        { method: "PATCH", jsonBody: patch },
        f
      );
    },

    getIntegrationApiKeys(): Promise<MerchantApiKey[]> {
      return dashboardJson(base, "/integrations/api-keys", { method: "GET" }, f);
    },

    createIntegrationApiKey(payload: { name?: string; scopes?: string[] }): Promise<CreatedMerchantApiKey> {
      return dashboardJson(base, "/integrations/api-keys", { method: "POST", jsonBody: payload }, f);
    },

    revokeIntegrationApiKey(apiKeyId: string): Promise<MerchantApiKey> {
      return dashboardJson(base, `/integrations/api-keys/${encodeURIComponent(apiKeyId)}`, { method: "DELETE" }, f);
    },

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
          {
            method: "PUT",
            headers: { "If-Match": "*" },
            jsonBody: payload,
          },
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

    async getOrders(limit?: number): Promise<TenantOrder[]> {
      const query = limit ? `?limit=${encodeURIComponent(String(limit))}` : "";
      return (
        await dashboardJson<CursorPage<TenantOrder>>(
          base,
          `/orders${query}`,
          { method: "GET" },
          f,
        )
      ).data;
    },

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

    createEmbedSession(payload: {
      ttl_seconds?: number;
      allowed_origin?: string;
      scopes?: string[];
      cart_ref?: string;
    }): Promise<EmbedSessionResponse> {
      return dashboardJson(base, "/embed/sessions", { method: "POST", jsonBody: payload }, f);
    },

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

    getBillingSubscription(): Promise<BillingSubscription> {
      return dashboardJson(base, "/billing/subscription", { method: "GET" }, f);
    },

    createBillingCheckoutSession(payload: { price_id?: string; success_url?: string; cancel_url?: string }): Promise<BillingCheckoutSessionResponse> {
      return dashboardJson(base, "/billing/checkout-session", { method: "POST", jsonBody: payload }, f);
    },

    createBillingPortalSession(payload: { return_url?: string }): Promise<BillingPortalSessionResponse> {
      return dashboardJson(base, "/billing/portal-session", { method: "POST", jsonBody: payload }, f);
    },

    getPaymentConnections(): Promise<PaymentConnection[]> {
      return dashboardJson<PaymentConnection[]>(base, "/payments/connections", { method: "GET" }, f);
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

    async getAuditEvents(limit?: number): Promise<AuditEvent[]> {
      const query = limit ? `?limit=${encodeURIComponent(String(limit))}` : "";
      const response = await dashboardJson<AuditEvent[] | CursorPage<AuditEvent>>(
        base,
        `/audit-events${query}`,
        { method: "GET" },
        f,
      );
      return Array.isArray(response) ? response : response.data;
    },

    getAgentRules(): Promise<AgentRules> {
      return dashboardJson(base, "/agent-rules", { method: "GET" }, f);
    },

    putAgentRules(payload: AgentRules): Promise<AgentRules> {
      return dashboardJson(base, "/agent-rules", { method: "PUT", jsonBody: payload }, f);
    },

    getAgentRulesContext(): Promise<Record<string, unknown>> {
      return dashboardJson(base, "/agent-rules/context", { method: "GET" }, f);
    },

    getNegotiationPolicy(): Promise<NegotiationPolicy> {
      return dashboardJson(base, "/negotiations/policy", { method: "GET" }, f);
    },

    putNegotiationPolicy(payload: NegotiationPolicy): Promise<NegotiationPolicy> {
      return dashboardJson(base, "/negotiations/policy", { method: "PUT", jsonBody: payload }, f);
    },

    getCommerceConnections(): Promise<CommerceConnection[]> {
      return dashboardJson<CommerceConnection[]>(base, "/commerce/connections", { method: "GET" }, f);
    },

    createCommerceConnection(payload: { platform: string; shop_domain?: string; credentials?: Record<string, unknown> }): Promise<CommerceConnection> {
      return dashboardJson(base, "/commerce/connections", { method: "POST", jsonBody: payload }, f);
    },

    testCommerceConnection(connectionId: string): Promise<{ ok: boolean; message?: string }> {
      return dashboardJson(base, `/commerce/connections/${encodeURIComponent(connectionId)}/test`, { method: "POST" }, f);
    },

    syncCommerceConnection(connectionId: string): Promise<CommerceConnection> {
      return dashboardJson(base, `/commerce/connections/${encodeURIComponent(connectionId)}/sync`, { method: "POST" }, f);
    },

    deleteCommerceConnection(connectionId: string): Promise<Record<string, never>> {
      return dashboardJson(base, `/commerce/connections/${encodeURIComponent(connectionId)}`, { method: "DELETE" }, f);
    },

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

function createIdempotencyKey(): string {
  const random =
    typeof globalThis.crypto?.randomUUID === "function"
      ? globalThis.crypto.randomUUID()
      : `${Date.now()}_${Math.random().toString(36).slice(2)}`;
  return `dashboard_${random}`;
}

export function stableIdempotencyKey(actionId: string): string {
  return `dashboard_action_${actionId}`;
}

type WebhookEndpointApi = {
  id: string;
  url: string;
  enabled: boolean;
  events: string[];
  description: string | null;
  signing_secret?: string;
  signing_secret_hint: string;
  created_at: string;
  updated_at: string;
};

type WebhookDeliveryApi = {
  id: string;
  endpoint_id: string;
  endpoint_url: string;
  event_id: string;
  event_type: string;
  status: "pending" | "delivered" | "failed";
  attempts: number;
  next_attempt_at: string | null;
  response_status: number | null;
  response_body: string | null;
  error: string | null;
  created_at: string;
  updated_at: string;
  delivered_at: string | null;
};

function mapWebhookEndpoint(value: WebhookEndpointApi): WebhookEndpoint {
  return {
    id: value.id,
    url: value.url,
    enabled: value.enabled,
    events: value.events,
    description: value.description ?? undefined,
    createdAt: value.created_at,
    updatedAt: value.updated_at,
    signingSecret: value.signing_secret,
    signingSecretHint: value.signing_secret_hint,
  };
}

function mapWebhookDelivery(value: WebhookDeliveryApi): WebhookDelivery {
  return {
    id: value.id,
    endpointId: value.endpoint_id,
    endpointUrl: value.endpoint_url,
    eventId: value.event_id,
    eventType: value.event_type,
    status: value.status,
    attempts: value.attempts,
    nextAttemptAt: value.next_attempt_at ?? undefined,
    responseStatus: value.response_status ?? undefined,
    responseBody: value.response_body ?? undefined,
    error: value.error ?? undefined,
    createdAt: value.created_at,
    updatedAt: value.updated_at,
    deliveredAt: value.delivered_at ?? undefined,
  };
}
