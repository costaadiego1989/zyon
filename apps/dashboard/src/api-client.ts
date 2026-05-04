import type {
  CheckoutSettings,
  CheckoutSettingsPatch,
  DashboardOverview,
  MerchantRules
} from "@aacp/shared-types";

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

export type MerchantProfile = {
  id: string;
  name: string;
};

export type NegotiationEvaluateBridgeResponse = Record<string, unknown> & {
  negotiation_session_id?: string;
};

/**
 * Fetch com sessão merchant: credenciais **sempre** `include` (cookies HttpOnly).
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

  return fetchImpl(mergeUrl(apiBaseUrl, path), {
    ...rest,
    headers,
    body: finalBody,
    credentials: "include"
  });
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

    merchantProfile(): Promise<MerchantProfile> {
      return dashboardJson<MerchantProfile>(base, "/merchants/me", { method: "GET" }, f);
    },

    getMerchantRules(): Promise<MerchantRules> {
      return dashboardJson(base, "/merchants/me/rules", { method: "GET" }, f);
    },

    putMerchantRules(patch: Partial<MerchantRules>): Promise<MerchantRules> {
      return dashboardJson(base, "/merchants/me/rules", { method: "PUT", jsonBody: patch }, f);
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
    }
  };
}
