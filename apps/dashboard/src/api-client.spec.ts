import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { dashboardFetch, DashboardHttpError, dashboardJson, createDashboardApi } from "./api-client";

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
      "http://localhost:3001/merchants/me",
      expect.objectContaining({ credentials: "include" })
    );
  });

  it("normaliza barras repetidas entre base e path", async () => {
    const spy = vi.mocked(fetch);
    await dashboardFetch("http://localhost:3001///", "//foo/bar", {});
    expect(spy.mock.calls[0]![0]).toBe("http://localhost:3001/foo/bar");
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
      "http://localhost:9999/negotiations/evaluate",
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
      "http://localhost:9999/support/tickets?status=open",
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
      "http://localhost:9999/auth/register",
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
      "http://localhost:9999/auth/logout",
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
      "http://localhost:9999/support/tickets/sup_1",
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

    await api.getIntegrationApiKeys();
    await api.getWebhookDeliveries(20);
    await api.getTenantShipments(50);

    expect(spy).toHaveBeenCalledWith(
      "http://localhost:9999/integrations/api-keys",
      expect.objectContaining({ credentials: "include", method: "GET" })
    );
    expect(spy).toHaveBeenCalledWith(
      "http://localhost:9999/integrations/webhook-deliveries?limit=20",
      expect.objectContaining({ credentials: "include", method: "GET" })
    );
    expect(spy).toHaveBeenCalledWith(
      "http://localhost:9999/integrations/shipments?limit=50",
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
      "http://localhost:9999/embed-sessions",
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
      "http://localhost:9999/merchants/me/theme",
      expect.objectContaining({ credentials: "include", method: "GET" })
    );
    expect(spy).toHaveBeenCalledWith(
      "http://localhost:9999/merchants/me/theme",
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
