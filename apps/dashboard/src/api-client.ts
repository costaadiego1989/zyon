import type {
  CheckoutSettings,
  CheckoutSettingsPatch,
  DashboardOverview,
  MerchantRules,
  MerchantTheme,
  OnboardingStateResponse,
  OnboardingStepId,
  SupportSettings,
  SupportSettingsPatch,
  SupportTicket,
  SupportTicketStatus,
  SupportTicketStatusPatch,
} from "@aacp/shared-types";

export type { OnboardingStateResponse, OnboardingStepId } from "@aacp/shared-types";

export type { DashboardOverview } from "@aacp/shared-types";

/** Base da API (sem barra final), ex.: `http://localhost:3001`. */
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

function mergeUrl(baseUrl: string, path: string): string {
  const base = normalizeApiBase(baseUrl);
  return `${base}${mergePath(path)}`;
}

/** POST /auth/login (define cookie HttpOnly). */
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

export type TenantShipment = {
  id: string;
  merchantId: string;
  sessionId: string;
  externalOrderId: string;
  carrier: string;
  trackingCode: string;
  trackingUrl?: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  estimatedEta?: string;
  deliveredAt?: string;
};

export type EmbedSessionResponse = {
  embed_session_token: string;
  expires_at_unix: number;
};

/**
 * Fetch com sessão merchant: credenciais **sempre** `include` (cookies HttpOnly).
 * Ao receber 401, tenta refresh silencioso e retenta a request original.
 */
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

  // Se 401 e não é o próprio refresh/login, tenta renovar token
  if (res.status === 401 && !path.includes("/auth/")) {
    const refreshed = await silentRefresh(apiBaseUrl, fetchImpl);
    if (refreshed) {
      // Retenta a request original com o novo cookie
      return doFetch();
    }
  }

  return res;
}

/** Tenta renovar o token via POST /auth/refresh. Retorna true se sucesso. */
let refreshInFlight: Promise<boolean> | null = null;

async function silentRefresh(apiBaseUrl: string, fetchImpl: typeof fetch): Promise<boolean> {
  // Evita múltiplos refreshes simultâneos
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

/** Evento disparado quando sessão expirou definitivamente (refresh falhou). */
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

    /** Rotas públicas MVP (merchant no path) — continuam disponíveis sem login */
    getDashboardOverview(merchantId: string): Promise<DashboardOverview> {
      return dashboardJson(base, `/dashboard/overview/${encodeURIComponent(merchantId)}`, { method: "GET" }, f);
    },

    getDashboardRulesLegacy(
      merchantId: string
    ): Promise<MerchantRules> {
      return dashboardJson(base, `/dashboard/rules/${encodeURIComponent(merchantId)}`, { method: "GET" }, f);
    },

    putDashboardRulesLegacy(
      merchantId: string,
      patch: Partial<MerchantRules>
    ): Promise<MerchantRules> {
      return dashboardJson(base, `/dashboard/rules/${encodeURIComponent(merchantId)}`, { method: "PUT", jsonBody: patch }, f);
    },

    getCheckoutSettings(): Promise<CheckoutSettings> {
      return dashboardJson(base, "/checkout-settings", { method: "GET" }, f);
    },

    patchCheckoutSettings(patch: CheckoutSettingsPatch): Promise<CheckoutSettings> {
      return dashboardJson(base, "/checkout-settings", { method: "PUT", jsonBody: patch }, f);
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

    getWebhookEndpoints(): Promise<WebhookEndpoint[]> {
      return dashboardJson(base, "/integrations/webhooks", { method: "GET" }, f);
    },

    createWebhookEndpoint(payload: { url: string; events?: string[]; enabled?: boolean; description?: string }): Promise<WebhookEndpoint> {
      return dashboardJson(base, "/integrations/webhooks", { method: "POST", jsonBody: payload }, f);
    },

    updateWebhookEndpoint(endpointId: string, payload: { url: string; events?: string[]; enabled?: boolean; description?: string }): Promise<WebhookEndpoint> {
      return dashboardJson(base, `/integrations/webhooks/${encodeURIComponent(endpointId)}`, { method: "PUT", jsonBody: payload }, f);
    },

    testWebhookEndpoint(endpointId: string): Promise<WebhookDelivery> {
      return dashboardJson(base, `/integrations/webhooks/${encodeURIComponent(endpointId)}/test`, { method: "POST" }, f);
    },

    getWebhookDeliveries(limit?: number): Promise<WebhookDelivery[]> {
      const query = limit ? `?limit=${encodeURIComponent(String(limit))}` : "";
      return dashboardJson(base, `/integrations/webhook-deliveries${query}`, { method: "GET" }, f);
    },

    replayWebhookDelivery(deliveryId: string): Promise<WebhookDelivery> {
      return dashboardJson(base, `/integrations/webhook-deliveries/${encodeURIComponent(deliveryId)}/replay`, { method: "POST" }, f);
    },

    getTenantShipments(limit?: number): Promise<TenantShipment[]> {
      const query = limit ? `?limit=${encodeURIComponent(String(limit))}` : "";
      return dashboardJson(base, `/integrations/shipments${query}`, { method: "GET" }, f);
    },

    createEmbedSession(payload: {
      ttl_seconds?: number;
      allowed_origin?: string;
      scopes?: string[];
      cart_ref?: string;
    }): Promise<EmbedSessionResponse> {
      return dashboardJson(base, "/embed-sessions", { method: "POST", jsonBody: payload }, f);
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
  };
}

function createIdempotencyKey(): string {
  const random =
    typeof globalThis.crypto?.randomUUID === "function"
      ? globalThis.crypto.randomUUID()
      : `${Date.now()}_${Math.random().toString(36).slice(2)}`;
  return `dashboard_${random}`;
}
