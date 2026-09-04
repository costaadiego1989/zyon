import { afterEach, describe, expect, it, vi } from "vitest";
import { PulseAPI } from "../features/pulse/model/PulseAPI.js";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.unstubAllEnvs();
});

describe("PulseAPI checkout readiness", () => {
  it("uses stable idempotency key and standard bearer embed auth", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ id: "pay_1" })
    }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const api = new PulseAPI({
      baseUrl: "https://api.example.com",
      merchantId: "mrc_1",
      sessionId: "sess_1",
      sessionToken: "embed_token",
      allowDemoFallbacks: false
    });

    await api.createOrder("credito", undefined, 3);
    await api.createOrder("credito", undefined, 3);

    const calls = fetchMock.mock.calls as unknown as Array<[RequestInfo | URL, RequestInit]>;
    const bodies = calls.map((call) => JSON.parse(String(call[1]?.body)));
    expect(bodies[0].idempotency_key).toBe("pulse::sess_1::credito::3");
    expect(bodies[1].idempotency_key).toBe("pulse::sess_1::credito::3");
    expect(calls[0]?.[1]?.headers).toMatchObject({
      Authorization: "Bearer embed_token"
    });
  });

  it("fails closed in production when payment provider is unavailable", async () => {
    const api = new PulseAPI({ allowDemoFallbacks: false });
    await expect(api.createOrder("pix")).rejects.toThrow("payment_provider_unavailable");
  });

  it("maps approved PIX status to paid", async () => {
    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({ status: "approved" })
    })) as unknown as typeof fetch;

    const api = new PulseAPI({
      baseUrl: "https://api.example.com",
      sessionId: "sess_1",
      sessionToken: "embed_token",
      allowDemoFallbacks: false
    });

    await expect(api.checkPaymentStatus("pay_1")).resolves.toBe("paid");
  });
});
