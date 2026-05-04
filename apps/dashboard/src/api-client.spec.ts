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
});
