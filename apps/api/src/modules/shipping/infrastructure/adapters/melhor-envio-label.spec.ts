import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { MelhorEnvioCarrierAdapter } from "./melhor-envio.carrier.js";

const BASE_ENV = {
  MELHOR_ENVIO_TOKEN: "test-bearer-token",
  MELHOR_ENVIO_BASE_URL: "https://sandbox.melhorenvio.com.br",
  MELHOR_ENVIO_FROM_ZIP: "01000000"
};

function withEnv<T>(overrides: Record<string, string | undefined>, fn: () => T): T {
  const prev: Record<string, string | undefined> = {};
  for (const key of Object.keys(overrides)) {
    prev[key] = process.env[key];
    if (overrides[key] === undefined) delete process.env[key];
    else process.env[key] = overrides[key];
  }
  try { return fn(); }
  finally {
    for (const key of Object.keys(overrides)) {
      if (prev[key] === undefined) delete process.env[key];
      else process.env[key] = prev[key];
    }
  }
}

function mockFetch(handler: (url: string, opts: RequestInit) => Response | Promise<Response>) {
  const original = globalThis.fetch;
  globalThis.fetch = handler as typeof fetch;
  return () => { globalThis.fetch = original; };
}

describe("MelhorEnvioCarrierAdapter.purchaseLabel", () => {
  it("calls cart + checkout + generate endpoints in sequence and returns label data", async () => {
    const calls: Array<{ url: string; body: unknown }> = [];

    const restore = mockFetch(async (url, opts) => {
      const body = opts.body ? JSON.parse(opts.body as string) : null;
      calls.push({ url, body });

      if (url.includes("/cart")) {
        return new Response(JSON.stringify({ id: "cart_item_1" }), { status: 200 });
      }
      if (url.includes("/shipment/checkout")) {
        return new Response(JSON.stringify({
          purchase: { id: "purchase_1", tracking: "ME123456789BR", status: "released" }
        }), { status: 200 });
      }
      if (url.includes("/shipment/generate")) {
        return new Response(JSON.stringify({
          "cart_item_1": { status: true, message: "generated" }
        }), { status: 200 });
      }
      return new Response("", { status: 404 });
    });

    try {
      const adapter = new MelhorEnvioCarrierAdapter();
      const result = await withEnv(BASE_ENV, async () => adapter.purchaseLabel({
        serviceId: 1,
        fromZip: "01000-000",
        toZip: "01310-100",
        toName: "João Silva",
        toDocument: "12345678900",
        packages: [{ weightKg: 1, widthCm: 20, heightCm: 10, lengthCm: 20, quantity: 1 }],
        invoiceKey: "NFE_KEY_123",
      }));

      assert.equal(calls.length, 3);
      assert.ok(calls[0]!.url.includes("/api/v2/me/cart"));
      assert.ok(calls[1]!.url.includes("/api/v2/me/shipment/checkout"));
      assert.ok(calls[2]!.url.includes("/api/v2/me/shipment/generate"));
      assert.equal(result.trackingCode, "ME123456789BR");
      assert.equal(result.purchaseId, "purchase_1");
    } finally {
      restore();
    }
  });

  it("throws when token is missing", async () => {
    const adapter = new MelhorEnvioCarrierAdapter();
    await assert.rejects(
      withEnv({ ...BASE_ENV, MELHOR_ENVIO_TOKEN: undefined }, async () =>
        adapter.purchaseLabel({
          serviceId: 1,
          fromZip: "01000-000",
          toZip: "01310-100",
          toName: "João",
          toDocument: "123",
          packages: [{ weightKg: 1, widthCm: 20, heightCm: 10, lengthCm: 20, quantity: 1 }],
        })
      ) as Promise<unknown>,
      /melhor_envio_token_missing/
    );
  });

  it("throws when cart API fails", async () => {
    const restore = mockFetch(async () => new Response("error", { status: 422 }));
    try {
      const adapter = new MelhorEnvioCarrierAdapter();
      await assert.rejects(
        withEnv(BASE_ENV, async () =>
          adapter.purchaseLabel({
            serviceId: 1,
            fromZip: "01000-000",
            toZip: "01310-100",
            toName: "João",
            toDocument: "123",
            packages: [{ weightKg: 1, widthCm: 20, heightCm: 10, lengthCm: 20, quantity: 1 }],
          })
        ) as Promise<unknown>,
        /melhor_envio_cart_failed/
      );
    } finally {
      restore();
    }
  });
});

describe("MelhorEnvioCarrierAdapter.getTracking", () => {
  it("returns tracking events from Melhor Envio tracking endpoint", async () => {
    const restore = mockFetch(async (url) => {
      if (url.includes("/tracking")) {
        return new Response(JSON.stringify({
          "ME123456789BR": {
            id: "shp_1",
            tracking: "ME123456789BR",
            status: "delivered",
            events: [
              { status: "posted", date: "2026-07-15 10:00", description: "Objeto postado" },
              { status: "delivered", date: "2026-07-18 14:30", description: "Objeto entregue" }
            ]
          }
        }), { status: 200 });
      }
      return new Response("", { status: 404 });
    });

    try {
      const adapter = new MelhorEnvioCarrierAdapter();
      const result = await withEnv(BASE_ENV, async () =>
        adapter.getTracking("ME123456789BR")
      );

      assert.equal(result.status, "delivered");
      assert.equal(result.events.length, 2);
      assert.equal(result.events[0]!.status, "posted");
      assert.equal(result.events[1]!.description, "Objeto entregue");
    } finally {
      restore();
    }
  });

  it("throws when tracking code not found", async () => {
    const restore = mockFetch(async () =>
      new Response(JSON.stringify({}), { status: 200 })
    );

    try {
      const adapter = new MelhorEnvioCarrierAdapter();
      await assert.rejects(
        withEnv(BASE_ENV, async () => adapter.getTracking("INVALID")) as Promise<unknown>,
        /melhor_envio_tracking_not_found/
      );
    } finally {
      restore();
    }
  });

  it("throws when token is missing", async () => {
    const adapter = new MelhorEnvioCarrierAdapter();
    await assert.rejects(
      withEnv({ ...BASE_ENV, MELHOR_ENVIO_TOKEN: undefined }, async () =>
        adapter.getTracking("ME123")
      ) as Promise<unknown>,
      /melhor_envio_token_missing/
    );
  });
});
