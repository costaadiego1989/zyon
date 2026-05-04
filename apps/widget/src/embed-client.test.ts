import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { checkoutJson, CHECKOUT_EMBED_PATHS } from "./embed-client";

describe("checkoutJson", () => {
  const origin = "http://localhost:3001";

  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ ok: true })
        } as Response)
      )
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("envia embed token no cabeçalho quando modo embed", async () => {
    const spy = vi.mocked(fetch);
    await checkoutJson(origin, CHECKOUT_EMBED_PATHS.start, {
      embedToken: "tok.test",
      body: { cart: { currency: "BRL", total: 1, items: [] } }
    });

    expect(spy).toHaveBeenCalledTimes(1);
    const [, init] = spy.mock.calls[0]!;
    expect(init!.method).toBe("POST");
    expect(init!.headers).toMatchObject({
      "Content-Type": "application/json",
      "x-aacp-embed-token": "tok.test"
    });
  });

  it("não inclui embed token quando ausente", async () => {
    const spy = vi.mocked(fetch);
    await checkoutJson(origin, CHECKOUT_EMBED_PATHS.track, {
      body: {
        merchant_id: "m1",
        session_id: "s1",
        event: "checkout_started"
      }
    });

    const headers = spy.mock.calls[0]![1]!.headers as Record<string, string>;
    expect(headers["x-aacp-embed-token"]).toBeUndefined();
    expect(headers["Content-Type"]).toBe("application/json");
  });
});
