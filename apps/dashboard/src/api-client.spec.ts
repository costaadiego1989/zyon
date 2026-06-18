/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { dashboardFetch, DashboardHttpError, dashboardJson, createDashboardApi, SESSION_EXPIRED_EVENT, stableIdempotencyKey } from "./api-client";

describe("dashboardFetch", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (): Promise<Response> => {
        return {
          ok: true,
          status: 200,
          text: async () => "{}",
          json: async () => ({})
        } as Response;
      })
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("usar sempre credentials include", async () => {
    const spy = vi.mocked(fetch);
    await dashboardFetch("http://localhost:3001/", "/merchants/me", { method: "GET" });
    expect(spy).toHaveBeenCalledWith(
      "http://localhost:3001/v1/merchants/me",
      expect.objectContaining({ credentials: "include" })
    );
  });

  it("normaliza barras repetidas entre base e path", async () => {
    const spy = vi.mocked(fetch);
    await dashboardFetch("http://localhost:3001///", "//foo/bar", {});
    expect(spy.mock.calls[0]![0]).toBe("http://localhost:3001/v1/foo/bar");
  });

  it("nao duplica a versao quando a base ja termina em /v1", async () => {
    const spy = vi.mocked(fetch);
    await dashboardFetch("http://localhost:3001/v1", "/orders", {});
    expect(spy.mock.calls[0]![0]).toBe("http://localhost:3001/v1/orders");
  });

  it("envia JSON e Content-Type quando jsonBody existe", async () => {
    const spy = vi.mocked(fetch);
    await dashboardFetch("http://api.test", "/auth/login", {
      method: "POST",
      jsonBody: { email: "a@b.co", password: "x" }
    });
    const [, init] = spy.mock.calls[0]!;
    expect(init).toMatchObject({
      credentials: "include",
      method: "POST",
      body: JSON.stringify({ email: "a@b.co", password: "x" }),
      headers: expect.any(Headers)
    });
    expect((init!.headers as Headers).get("Content-Type")).toBe("application/json");
  });
});

describe("dashboardJson", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (): Promise<Response> => {
        return {
          ok: false,
          status: 401,
          text: async () => '{"err":true}',
          json: async () => ({ err: true })
        } as Response;
      })
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("lança DashboardHttpError quando resposta não ok", async () => {
    await expect(dashboardJson("http://x", "/y")).rejects.toBeInstanceOf(DashboardHttpError);
    try {
      await dashboardJson("http://x", "/y");
    } catch (e) {
      expect(e).toMatchObject({
        status: 401,
        responseBody: '{"err":true}'
      });
    }
  });
});

describe("createDashboardApi", () => {
  it("evaluateNegotiation chama POST no path público esperado", async () => {
    const spy = vi.fn(
      async (): Promise<Response> =>
        ({
          ok: true,
          status: 200,
          text: async () => '{"agreement":false}'
        }) as Response
    );
    const api = createDashboardApi({
      baseUrl: "http://localhost:9999/",
      fetchImpl: spy as typeof fetch
    });
    const out = await api.evaluateNegotiation({ cart: { total: 120, items: [{ sku: "x", price: 120, quantity: 1 }] } });
    expect(spy).toHaveBeenCalledWith(
      "http://localhost:9999/v1/negotiations/evaluate",
      expect.objectContaining({
        credentials: "include",
        method: "POST"
      })
    );
    expect(out.agreement).toBe(false);
  });

  it("getSupportTickets chama rota autenticada com filtro opcional", async () => {
    const spy = vi.fn(
      async (): Promise<Response> =>
        ({
          ok: true,
          status: 200,
          text: async () => "[]"
        }) as Response
    );
    const api = createDashboardApi({
      baseUrl: "http://localhost:9999/",
      fetchImpl: spy as typeof fetch
    });

    await api.getSupportTickets("open");

    expect(spy).toHaveBeenCalledWith(
      "http://localhost:9999/v1/support/tickets?status=open",
      expect.objectContaining({
        credentials: "include",
        method: "GET"
      })
    );
  });

  it("register and logout call merchant auth routes with cookies", async () => {
    const spy = vi.fn(
      async (url: RequestInfo | URL): Promise<Response> =>
        ({
          ok: true,
          status: String(url).endsWith("/auth/logout") ? 204 : 200,
          text: async () =>
            String(url).endsWith("/auth/logout")
              ? ""
              : JSON.stringify({
                  merchant_id: "mrc_1",
                  user_id: "usr_1",
                  email: "owner@example.com",
                  access_token: "jwt",
                  token_type: "Bearer",
                  expires_in: 3600
                })
        }) as Response
    );
    const api = createDashboardApi({
      baseUrl: "http://localhost:9999/",
      fetchImpl: spy as typeof fetch
    });

    await api.register({
      merchant_name: "Northstar",
      email: "owner@example.com",
      password: "secret"
    });
    await api.logout();

    expect(spy).toHaveBeenCalledWith(
      "http://localhost:9999/v1/auth/register",
      expect.objectContaining({
        credentials: "include",
        method: "POST",
        body: JSON.stringify({
          merchant_name: "Northstar",
          email: "owner@example.com",
          password: "secret"
        })
      })
    );
    expect(spy).toHaveBeenCalledWith(
      "http://localhost:9999/v1/auth/logout",
      expect.objectContaining({
        credentials: "include",
        method: "POST"
      })
    );
  });

  it("patchSupportTicketStatus envia PATCH para atualizar status", async () => {
    const spy = vi.fn(
      async (): Promise<Response> =>
        ({
          ok: true,
          status: 200,
          text: async () =>
            JSON.stringify({
              id: "sup_1",
              merchantId: "mrc_1",
              buyerMessage: "Ajuda",
              status: "resolved",
              source: "widget",
              createdAt: "2026-05-21T00:00:00.000Z",
              updatedAt: "2026-05-21T00:00:00.000Z"
            })
        }) as Response
    );
    const api = createDashboardApi({
      baseUrl: "http://localhost:9999/",
      fetchImpl: spy as typeof fetch
    });

    const out = await api.patchSupportTicketStatus("sup_1", "resolved");

    expect(spy).toHaveBeenCalledWith(
      "http://localhost:9999/v1/support/tickets/sup_1",
      expect.objectContaining({
        credentials: "include",
        method: "PATCH",
        body: JSON.stringify({ status: "resolved" })
      })
    );
    expect(out.status).toBe("resolved");
  });

  it("integration API helpers call authenticated tenant routes", async () => {
    const spy = vi.fn(
      async (url: RequestInfo | URL): Promise<Response> =>
        ({
          ok: true,
          status: 200,
          text: async () =>
            String(url).includes("/integrations/api-keys")
              ? "[]"
              : JSON.stringify({
                  data: [],
                  next_cursor: null,
                  has_more: false,
                }),
        }) as Response
    );
    const api = createDashboardApi({
      baseUrl: "http://localhost:9999/",
      fetchImpl: spy as typeof fetch
    });

    await api.getIntegrationApiKeys();
    await api.getWebhookDeliveries(20);
    await api.getOrders(50);

    expect(spy).toHaveBeenCalledWith(
      "http://localhost:9999/v1/integrations/api-keys",
      expect.objectContaining({ credentials: "include", method: "GET" })
    );
    expect(spy).toHaveBeenCalledWith(
      "http://localhost:9999/v1/webhook-endpoints",
      expect.objectContaining({ credentials: "include", method: "GET" })
    );
    expect(spy).toHaveBeenCalledWith(
      "http://localhost:9999/v1/orders?limit=50",
      expect.objectContaining({ credentials: "include", method: "GET" })
    );
  });

  it("createEmbedSession posts scoped token options", async () => {
    const spy = vi.fn(
      async (): Promise<Response> =>
        ({
          ok: true,
          status: 200,
          text: async () => JSON.stringify({ embed_session_token: "tok", expires_at_unix: 1779365700 })
        }) as Response
    );
    const api = createDashboardApi({
      baseUrl: "http://localhost:9999/",
      fetchImpl: spy as typeof fetch
    });

    const out = await api.createEmbedSession({
      ttl_seconds: 900,
      allowed_origin: "https://store.example",
      cart_ref: "cart_1",
      scopes: ["checkout:start"]
    });

    expect(spy).toHaveBeenCalledWith(
      "http://localhost:9999/v1/embed/sessions",
      expect.objectContaining({
        credentials: "include",
        method: "POST",
        body: JSON.stringify({
          ttl_seconds: 900,
          allowed_origin: "https://store.example",
          cart_ref: "cart_1",
          scopes: ["checkout:start"]
        })
      })
    );
    expect(out.embed_session_token).toBe("tok");
  });

  it("merchant theme helpers read and save enterprise theme", async () => {
    const spy = vi.fn(
      async (): Promise<Response> =>
        ({
          ok: true,
          status: 200,
          text: async () =>
            JSON.stringify({
              accentColor: "#0F766E",
              textColor: "#111827",
              backgroundColor: "#F7F8FA",
              fontFamily: "Inter, sans-serif",
              surfaceColor: "#FFFFFF",
              density: "comfortable"
            })
        }) as Response
    );
    const api = createDashboardApi({
      baseUrl: "http://localhost:9999/",
      fetchImpl: spy as typeof fetch
    });

    await api.getMerchantTheme();
    const saved = await api.putMerchantTheme({
      accentColor: "#0F766E",
      textColor: "#111827",
      backgroundColor: "#F7F8FA",
      fontFamily: "Inter, sans-serif",
      surfaceColor: "#FFFFFF",
      density: "comfortable"
    });

    expect(spy).toHaveBeenCalledWith(
      "http://localhost:9999/v1/merchants/me/theme",
      expect.objectContaining({ credentials: "include", method: "GET" })
    );
    expect(spy).toHaveBeenCalledWith(
      "http://localhost:9999/v1/merchants/me/theme",
      expect.objectContaining({
        credentials: "include",
        method: "PUT",
        body: JSON.stringify({
          accentColor: "#0F766E",
          textColor: "#111827",
          backgroundColor: "#F7F8FA",
          fontFamily: "Inter, sans-serif",
          surfaceColor: "#FFFFFF",
          density: "comfortable"
        })
      })
    );
    expect(saved.density).toBe("comfortable");
  });
});

describe("onboarding api", () => {
  const stateBody = {
    merchant_id: "mrc_1",
    steps: [
      { id: "account", status: "completed" },
      { id: "checkout_config", status: "pending" },
      { id: "embed", status: "pending" },
      { id: "publish", status: "pending" }
    ],
    completed: false,
    next_step: "checkout_config"
  };

  function stubFetch() {
    const spy = vi.fn(async (): Promise<Response> => {
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify(stateBody),
        json: async () => stateBody
      } as Response;
    });
    vi.stubGlobal("fetch", spy);
    return spy;
  }

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("getOnboardingState GET /onboarding com cookies", async () => {
    const spy = stubFetch();
    const api = createDashboardApi({ baseUrl: "http://api.test" });
    const state = await api.getOnboardingState();
    expect(spy).toHaveBeenCalledWith(
      "http://api.test/v1/onboarding",
      expect.objectContaining({ credentials: "include", method: "GET" })
    );
    expect(state.next_step).toBe("checkout_config");
  });

  it("completeOnboardingStep POST encoded step path", async () => {
    const spy = stubFetch();
    const api = createDashboardApi({ baseUrl: "http://api.test" });
    await api.completeOnboardingStep("checkout_config");
    expect(spy).toHaveBeenCalledWith(
      "http://api.test/v1/onboarding/steps/checkout_config/complete",
      expect.objectContaining({ credentials: "include", method: "POST" })
    );
  });
});

// BUG-AUTH-1 (P1) regression: SESSION_EXPIRED_EVENT must be emitted from
// dashboardFetch (not only dashboardJson) so all callers — including those
// that read the Response directly — react to session expiry.
describe("BUG-AUTH-1: SESSION_EXPIRED_EVENT emitted on failed refresh (P1 regression)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("emits SESSION_EXPIRED when silent refresh fails", async () => {
    // First call returns 401. Refresh call returns 401 (failed). Should emit.
    let callCount = 0;
    const fetchSpy = vi.fn(async (url: RequestInfo | URL): Promise<Response> => {
      callCount++;
      if (String(url).includes("/auth/refresh")) {
        return { ok: false, status: 401, text: async () => "unauthorized" } as Response;
      }
      return { ok: false, status: 401, text: async () => "unauthorized" } as Response;
    });
    const dispatchSpy = vi.spyOn(window, "dispatchEvent");

    await dashboardFetch("http://api.test", "/merchants/me", {}, fetchSpy as typeof fetch);

    const sessionExpiredEmitted = dispatchSpy.mock.calls.some(
      (call) => call[0] instanceof CustomEvent && (call[0] as CustomEvent).type === SESSION_EXPIRED_EVENT
    );
    expect(sessionExpiredEmitted).toBe(true);
  });

  it("emits SESSION_EXPIRED when second response after successful refresh is still 401", async () => {
    let callCount = 0;
    const fetchSpy = vi.fn(async (url: RequestInfo | URL): Promise<Response> => {
      callCount++;
      if (String(url).includes("/auth/refresh")) {
        // Refresh succeeds
        return { ok: true, status: 200, text: async () => "{}" } as Response;
      }
      // All non-refresh calls return 401 (session still dead after refresh)
      return { ok: false, status: 401, text: async () => "unauthorized" } as Response;
    });
    const dispatchSpy = vi.spyOn(window, "dispatchEvent");

    await dashboardFetch("http://api.test", "/merchants/me", {}, fetchSpy as typeof fetch);

    const sessionExpiredEmitted = dispatchSpy.mock.calls.some(
      (call) => call[0] instanceof CustomEvent && (call[0] as CustomEvent).type === SESSION_EXPIRED_EVENT
    );
    expect(sessionExpiredEmitted).toBe(true);
  });
});

// BUG-AUTH-3 (P2) regression: stableIdempotencyKey must return the same key
// for the same actionId so form retries reuse the key (deduplication).
describe("BUG-AUTH-3: stableIdempotencyKey is stable per actionId (P2 regression)", () => {
  it("returns the same key for the same actionId", () => {
    const id = "form-submit-abc123";
    expect(stableIdempotencyKey(id)).toBe(stableIdempotencyKey(id));
  });

  it("returns different keys for different actionIds", () => {
    expect(stableIdempotencyKey("action-1")).not.toBe(stableIdempotencyKey("action-2"));
  });

  it("key includes the actionId for traceability", () => {
    const key = stableIdempotencyKey("my-action");
    expect(key).toContain("my-action");
  });
});
