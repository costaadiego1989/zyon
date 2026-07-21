import test from "node:test";
import assert from "node:assert/strict";
import { MelhorEnvioCarrierAdapter } from "./melhor-envio.carrier.js";

const baseCtx = {
  originZip: "01000-000",
  destinationZip: "01310-100",
  cartTotalCents: 10_000,
  merchantId: "mrc_1",
  packages: [{ weightKg: 1, widthCm: 20, heightCm: 10, lengthCm: 20, quantity: 1 }]
};

function withEnv<T>(overrides: Record<string, string | undefined>, fn: () => T): T {
  const previous: Record<string, string | undefined> = {};
  for (const key of Object.keys(overrides)) {
    previous[key] = process.env[key];
    if (overrides[key] === undefined) delete process.env[key];
    else process.env[key] = overrides[key];
  }
  try {
    return fn();
  } finally {
    for (const key of Object.keys(overrides)) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  }
}

test("MelhorEnvioCarrierAdapter exposes carrierKey 'melhor-envio'", () => {
  const adapter = new MelhorEnvioCarrierAdapter();
  assert.equal(adapter.carrierKey, "melhor-envio");
});

test("MelhorEnvioCarrierAdapter returns [] when token missing", async () => {
  const adapter = new MelhorEnvioCarrierAdapter();
  const out = await withEnv({ MELHOR_ENVIO_TOKEN: undefined }, async () => adapter.fetchQuotes(baseCtx));
  assert.deepEqual(out, []);
});

test("MelhorEnvioCarrierAdapter returns [] when destination zip missing", async () => {
  const adapter = new MelhorEnvioCarrierAdapter();
  const out = await withEnv({ MELHOR_ENVIO_TOKEN: "fake-token" }, async () =>
    adapter.fetchQuotes({ ...baseCtx, destinationZip: "" })
  );
  assert.deepEqual(out, []);
});

test("MelhorEnvioCarrierAdapter returns [] when no origin zip and no MELHOR_ENVIO_FROM_ZIP", async () => {
  const adapter = new MelhorEnvioCarrierAdapter();
  const out = await withEnv(
    { MELHOR_ENVIO_TOKEN: "fake-token", MELHOR_ENVIO_FROM_ZIP: undefined },
    async () => adapter.fetchQuotes({ ...baseCtx, originZip: "" })
  );
  assert.deepEqual(out, []);
});

test("MelhorEnvioCarrierAdapter returns [] for short zips", async () => {
  const adapter = new MelhorEnvioCarrierAdapter();
  const out = await withEnv({ MELHOR_ENVIO_TOKEN: "fake-token" }, async () =>
    adapter.fetchQuotes({ ...baseCtx, destinationZip: "123" })
  );
  assert.deepEqual(out, []);
});

test("MelhorEnvioCarrierAdapter throws BadRequestException when no packages provided", async () => {
  const adapter = new MelhorEnvioCarrierAdapter();
  const err: unknown = await withEnv(
    { MELHOR_ENVIO_TOKEN: "fake-token", MELHOR_ENVIO_FROM_ZIP: "01000-000" },
    async () => {
      try {
        await adapter.fetchQuotes({ ...baseCtx, packages: [] });
        return null;
      } catch (e) {
        return e;
      }
    }
  );

  assert.ok(err, "should throw when packages missing");
  const e = err as { constructor: { name: string }; message: string };
  assert.equal(e.constructor.name, "BadRequestException");
  assert.match(e.message, /shipping_packages_invalid:packages_empty/);
});

test("MelhorEnvioCarrierAdapter returns [] when API responds with non-OK status", async () => {
  const originalFetch = globalThis.fetch;
  // mock fetch returning 401
  globalThis.fetch = (async () => new Response(JSON.stringify({ error: "unauthorized" }), { status: 401 })) as typeof fetch;

  try {
    const adapter = new MelhorEnvioCarrierAdapter();
    const out = await withEnv(
      { MELHOR_ENVIO_TOKEN: "fake-token", MELHOR_ENVIO_FROM_ZIP: "01000-000" },
      async () => adapter.fetchQuotes(baseCtx)
    );
    assert.deepEqual(out, []);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("MelhorEnvioCarrierAdapter transforms service response into ShippingQuoteResult with cents and delivery_time", async () => {
  const originalFetch = globalThis.fetch;
  const services = [
    { id: 1, name: "PAC", price: "19.90", currency: "BRL", delivery_time: 5, company: { name: "Correios" } },
    { id: 2, name: "SEDEX", price: "29.50", currency: "BRL", delivery_time: 2, company: { name: "Correios" } }
  ];
  globalThis.fetch = (async () =>
    new Response(JSON.stringify(services), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    })) as typeof fetch;

  try {
    const adapter = new MelhorEnvioCarrierAdapter();
    const out = await withEnv(
      { MELHOR_ENVIO_TOKEN: "fake-token", MELHOR_ENVIO_FROM_ZIP: "01000-000" },
      async () => adapter.fetchQuotes(baseCtx)
    );

    assert.equal(out.length, 2);
    assert.equal(out[0]!.carrier_key, "melhor-envio-1");
    assert.equal(out[0]!.label, "Correios PAC");
    assert.equal(out[0]!.price, 1990, "price is converted from reais to cents");
    assert.equal(out[0]!.eta_days, 5);
    assert.equal(out[0]!.is_free, false);
    assert.equal(out[1]!.carrier_key, "melhor-envio-2");
    assert.equal(out[1]!.price, 2950);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("MelhorEnvioCarrierAdapter skips services with missing or NaN price", async () => {
  const originalFetch = globalThis.fetch;
  const services = [
    { id: 1, name: "PAC", price: "19.90", currency: "BRL", delivery_time: 5, company: { name: "Correios" } },
    { id: 2, name: "Bad", price: "abc", currency: "BRL", delivery_time: 2, company: { name: "X" } },
    { id: 3, name: "Empty", price: "", currency: "BRL", delivery_time: 1, company: { name: "Y" } }
  ];
  globalThis.fetch = (async () => new Response(JSON.stringify(services), { status: 200 })) as typeof fetch;

  try {
    const adapter = new MelhorEnvioCarrierAdapter();
    const out = await withEnv(
      { MELHOR_ENVIO_TOKEN: "fake-token", MELHOR_ENVIO_FROM_ZIP: "01000-000" },
      async () => adapter.fetchQuotes(baseCtx)
    );

    assert.equal(out.length, 1, "only services with parseable price survive");
    assert.equal(out[0]!.carrier_key, "melhor-envio-1");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("MelhorEnvioCarrierAdapter swallows network errors and returns []", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => {
    throw new Error("network down");
  }) as typeof fetch;

  try {
    const adapter = new MelhorEnvioCarrierAdapter();
    const out = await withEnv(
      { MELHOR_ENVIO_TOKEN: "fake-token", MELHOR_ENVIO_FROM_ZIP: "01000-000" },
      async () => adapter.fetchQuotes(baseCtx)
    );
    assert.deepEqual(out, []);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("MelhorEnvioCarrierAdapter returns [] when API payload is not an array", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ error: "internal" }), { status: 200 })) as typeof fetch;

  try {
    const adapter = new MelhorEnvioCarrierAdapter();
    const out = await withEnv(
      { MELHOR_ENVIO_TOKEN: "fake-token", MELHOR_ENVIO_FROM_ZIP: "01000-000" },
      async () => adapter.fetchQuotes(baseCtx)
    );
    assert.deepEqual(out, []);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
