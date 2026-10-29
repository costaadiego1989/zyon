/**
 * Integration-level tests for MelhorEnvioCarrierAdapter.
 * Mocks fetch to verify:
 * - Correct endpoint, headers, and body construction
 * - Timeout handling (AbortSignal.timeout)
 * - HTTP error codes (401, 403, 5xx)
 * - Malformed JSON responses
 * - Package quantity handling
 * - CEP normalization
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { MelhorEnvioCarrierAdapter } from "./melhor-envio.carrier.js";
import type { ShippingContext } from "../../domain/ports/carrier.port.js";

const BASE_ENV = {
  MELHOR_ENVIO_TOKEN: "test-bearer-token",
  MELHOR_ENVIO_BASE_URL: "https://sandbox.melhorenvio.com.br",
  MELHOR_ENVIO_FROM_ZIP: "01000000"
};

const validCtx: ShippingContext = {
  originZip: "01000-000",
  destinationZip: "01310-100",
  cartTotalCents: 15000,
  merchantId: "mrc_integ_1",
  packages: [{ weightKg: 2, widthCm: 20, heightCm: 15, lengthCm: 30, quantity: 1 }]
};

function withEnv(overrides: Record<string, string | undefined>, fn: () => unknown): unknown {
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

describe("MelhorEnvioCarrierAdapter Integration", () => {
  it("sends correct endpoint, headers, and body structure to Melhor Envio API", async () => {
    let capturedUrl = "";
    let capturedHeaders: Record<string, string> = {};
    let capturedBody: unknown = null;

    const restore = mockFetch(async (url, opts) => {
      capturedUrl = url;
      capturedHeaders = Object.fromEntries(
        Object.entries(opts.headers as Record<string, string>)
      );
      capturedBody = JSON.parse(opts.body as string);
      return new Response(JSON.stringify([]), { status: 200 });
    });

    try {
      const adapter = new MelhorEnvioCarrierAdapter();
      await withEnv(BASE_ENV, async () => adapter.fetchQuotes(validCtx));

      assert.equal(capturedUrl, "https://sandbox.melhorenvio.com.br/api/v2/me/shipment/calculate");
      assert.equal(capturedHeaders["Authorization"], "Bearer test-bearer-token");
      assert.equal(capturedHeaders["Content-Type"], "application/json");
      assert.equal(capturedHeaders["Accept"], "application/json");
      assert.match(capturedHeaders["User-Agent"], /AACP/);

      const body = capturedBody as { from: { postal_code: string }; to: { postal_code: string }; products: unknown[]; services: string };
      assert.equal(body.from.postal_code, "01000000");
      assert.equal(body.to.postal_code, "01310100");
      assert.equal(body.products.length, 1);
      assert.equal(body.services, "1,2,17,18");
    } finally {
      restore();
    }
  });

  it("rejects invalid package dimensions instead of silently clamping", async () => {
    const restore = mockFetch(async () => new Response(JSON.stringify([]), { status: 200 }));

    try {
      const adapter = new MelhorEnvioCarrierAdapter();
      const ctx: ShippingContext = {
        ...validCtx,
        packages: [
          { weightKg: 0.05, widthCm: 0.5, heightCm: 0, lengthCm: 0.3, quantity: 3 },
        ]
      };

      await assert.rejects(
        withEnv(BASE_ENV, async () => adapter.fetchQuotes(ctx)) as Promise<unknown>,
        /shipping_packages_invalid:package_0:weight_too_low/
      );
    } finally {
      restore();
    }
  });

  it("handles multiple packages in request body", async () => {
    let capturedBody: unknown = null;

    const restore = mockFetch(async (_url, opts) => {
      capturedBody = JSON.parse(opts.body as string);
      return new Response(JSON.stringify([]), { status: 200 });
    });

    try {
      const adapter = new MelhorEnvioCarrierAdapter();
      const ctx: ShippingContext = {
        ...validCtx,
        packages: [
          { weightKg: 1, widthCm: 20, heightCm: 10, lengthCm: 30, quantity: 1 },
          { weightKg: 5, widthCm: 40, heightCm: 30, lengthCm: 50, quantity: 2 },
        ]
      };
      await withEnv(BASE_ENV, async () => adapter.fetchQuotes(ctx));

      const body = capturedBody as { products: Array<Record<string, number>> };
      assert.equal(body.products.length, 2, "sends all packages as products");
      assert.equal(body.products[1]!.weight, 5);
      assert.equal(body.products[1]!.quantity, 2);
    } finally {
      restore();
    }
  });

  it("handles HTTP 401 Unauthorized gracefully (returns [])", async () => {
    const restore = mockFetch(async () => new Response("Unauthorized", { status: 401 }));
    try {
      const adapter = new MelhorEnvioCarrierAdapter();
      const out = await withEnv(BASE_ENV, async () => adapter.fetchQuotes(validCtx)) as unknown[];
      assert.deepEqual(out, []);
    } finally {
      restore();
    }
  });

  it("handles HTTP 403 Forbidden gracefully (returns [])", async () => {
    const restore = mockFetch(async () => new Response("Forbidden", { status: 403 }));
    try {
      const adapter = new MelhorEnvioCarrierAdapter();
      const out = await withEnv(BASE_ENV, async () => adapter.fetchQuotes(validCtx)) as unknown[];
      assert.deepEqual(out, []);
    } finally {
      restore();
    }
  });

  it("handles HTTP 500 Internal Server Error gracefully (returns [])", async () => {
    const restore = mockFetch(async () => new Response("Internal Error", { status: 500 }));
    try {
      const adapter = new MelhorEnvioCarrierAdapter();
      const out = await withEnv(BASE_ENV, async () => adapter.fetchQuotes(validCtx)) as unknown[];
      assert.deepEqual(out, []);
    } finally {
      restore();
    }
  });

  it("handles malformed JSON response gracefully (returns [])", async () => {
    const restore = mockFetch(async () => new Response("not json {{", { status: 200, headers: { "Content-Type": "text/html" } }));
    try {
      const adapter = new MelhorEnvioCarrierAdapter();
      const out = await withEnv(BASE_ENV, async () => adapter.fetchQuotes(validCtx)) as unknown[];
      assert.deepEqual(out, []);
    } finally {
      restore();
    }
  });

  it("handles timeout/AbortError gracefully (returns [])", async () => {
    const restore = mockFetch(async () => { throw new DOMException("signal timed out", "TimeoutError"); });
    try {
      const adapter = new MelhorEnvioCarrierAdapter();
      const out = await withEnv(BASE_ENV, async () => adapter.fetchQuotes(validCtx)) as unknown[];
      assert.deepEqual(out, []);
    } finally {
      restore();
    }
  });

  it("handles DNS resolution failure gracefully (returns [])", async () => {
    const restore = mockFetch(async () => { throw new TypeError("fetch failed"); });
    try {
      const adapter = new MelhorEnvioCarrierAdapter();
      const out = await withEnv(BASE_ENV, async () => adapter.fetchQuotes(validCtx)) as unknown[];
      assert.deepEqual(out, []);
    } finally {
      restore();
    }
  });

  it("normalizes CEP with dashes and spaces (strips non-digits)", async () => {
    let capturedBody: unknown = null;
    const restore = mockFetch(async (_url, opts) => {
      capturedBody = JSON.parse(opts.body as string);
      return new Response(JSON.stringify([]), { status: 200 });
    });

    try {
      const adapter = new MelhorEnvioCarrierAdapter();
      const ctx: ShippingContext = {
        ...validCtx,
        originZip: " 01.000-000 ",
        destinationZip: " 01310 100 "
      };
      await withEnv(BASE_ENV, async () => adapter.fetchQuotes(ctx));

      const body = capturedBody as { from: { postal_code: string }; to: { postal_code: string } };
      assert.equal(body.from.postal_code, "01000000");
      assert.equal(body.to.postal_code, "01310100");
    } finally {
      restore();
    }
  });

  it("returns [] when CEP has fewer than 8 digits after normalization", async () => {
    const adapter = new MelhorEnvioCarrierAdapter();
    const ctx: ShippingContext = { ...validCtx, destinationZip: "1234" };
    const out = await withEnv(BASE_ENV, async () => adapter.fetchQuotes(ctx)) as unknown[];
    assert.deepEqual(out, []);
  });

  it("falls back to MELHOR_ENVIO_FROM_ZIP when ctx.originZip is empty", async () => {
    let capturedBody: unknown = null;
    const restore = mockFetch(async (_url, opts) => {
      capturedBody = JSON.parse(opts.body as string);
      return new Response(JSON.stringify([]), { status: 200 });
    });

    try {
      const adapter = new MelhorEnvioCarrierAdapter();
      const ctx: ShippingContext = { ...validCtx, originZip: "" };
      await withEnv(BASE_ENV, async () => adapter.fetchQuotes(ctx));

      const body = capturedBody as { from: { postal_code: string } };
      assert.equal(body.from.postal_code, "01000000", "should use MELHOR_ENVIO_FROM_ZIP env");
    } finally {
      restore();
    }
  });

  it("returns [] when both ctx.originZip and MELHOR_ENVIO_FROM_ZIP are empty", async () => {
    const adapter = new MelhorEnvioCarrierAdapter();
    const ctx: ShippingContext = { ...validCtx, originZip: "" };
    const out = await withEnv(
      { ...BASE_ENV, MELHOR_ENVIO_FROM_ZIP: "" },
      async () => adapter.fetchQuotes(ctx)
    ) as unknown[];
    assert.deepEqual(out, []);
  });

  it("maps multi-service response with correct conversion (reais to cents)", async () => {
    const services = [
      { id: 1, name: "PAC", price: "19.90", currency: "BRL", delivery_time: 5, company: { name: "Correios" } },
      { id: 2, name: "SEDEX", price: "35.70", currency: "BRL", delivery_time: 2, company: { name: "Correios" } },
      { id: 17, name: ".Package", price: "22.50", currency: "BRL", delivery_time: 4, company: { name: "Jadlog" } },
      { id: 18, name: "Mini Envios", price: "9.99", currency: "BRL", delivery_time: 8, company: { name: "Correios" } }
    ];
    const restore = mockFetch(async () => new Response(JSON.stringify(services), { status: 200 }));

    try {
      const adapter = new MelhorEnvioCarrierAdapter();
      const out = await withEnv(BASE_ENV, async () => adapter.fetchQuotes(validCtx)) as Array<{ carrier_key: string; label: string; price: number; eta_days: number; is_free: boolean }>;

      assert.equal(out.length, 4);
      assert.equal(out[0]!.carrier_key, "melhor-envio-1");
      assert.equal(out[0]!.label, "Correios PAC");
      assert.equal(out[0]!.price, 1990);
      assert.equal(out[0]!.eta_days, 5);
      assert.equal(out[0]!.is_free, false);

      assert.equal(out[1]!.carrier_key, "melhor-envio-2");
      assert.equal(out[1]!.price, 3570);

      assert.equal(out[2]!.carrier_key, "melhor-envio-17");
      assert.equal(out[2]!.label, "Jadlog .Package");
      assert.equal(out[2]!.price, 2250);

      assert.equal(out[3]!.carrier_key, "melhor-envio-18");
      assert.equal(out[3]!.price, 999);
    } finally {
      restore();
    }
  });

  it("filters out services with error field instead of price (Melhor Envio error format)", async () => {
    const services = [
      { id: 1, name: "PAC", price: "19.90", currency: "BRL", delivery_time: 5, company: { name: "Correios" } },
      { id: 2, name: "SEDEX", price: "", currency: "BRL", delivery_time: 2, company: { name: "Correios" }, error: "Route unavailable" }
    ];
    const restore = mockFetch(async () => new Response(JSON.stringify(services), { status: 200 }));

    try {
      const adapter = new MelhorEnvioCarrierAdapter();
      const out = await withEnv(BASE_ENV, async () => adapter.fetchQuotes(validCtx)) as unknown[];
      assert.equal(out.length, 1, "only valid-price services pass");
    } finally {
      restore();
    }
  });
});
