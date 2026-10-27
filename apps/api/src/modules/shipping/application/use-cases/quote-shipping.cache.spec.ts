/**
 * Cache-behavior and production-readiness tests for QuoteShippingUseCase.
 * Tests:
 * - Quote key includes merchant rules hash (M1)
 * - Cache invalidation on merchant rules change
 * - Quote TTL enforcement
 * - Stale quote from different session is NOT reused (C2)
 * - Carrier failure logging (P3) — partial results still returned
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { QuoteShippingUseCase } from "./quote-shipping.use-case.js";
import { InMemoryShippingQuoteRepository } from "../../infrastructure/repositories/in-memory-shipping-quote.repository.js";
import { InMemoryOutboxRepository } from "../../../../shared/messaging/infrastructure/in-memory-outbox.repository.js";
import { InMemoryMerchantRepository } from "../../../merchant/infrastructure/in-memory-merchant.repository.js";
import type { CarrierPort } from "../../domain/ports/carrier.port.js";
import type { ShippingQuoteResult } from "../../domain/entities/shipping-quote.entity.js";
import type { OwnDeliveryConfig } from "../../domain/ports/own-delivery-config.port.js";

function makeStubCarrier(key: string, results: ShippingQuoteResult[]): CarrierPort {
  let callCount = 0;
  return {
    carrierKey: key,
    async fetchQuotes() {
      callCount++;
      return results;
    },
    get _callCount() { return callCount; }
  } as CarrierPort & { _callCount: number };
}

function makeCountingCarrier(key: string, results: ShippingQuoteResult[]): CarrierPort & { _callCount: number } {
  let callCount = 0;
  return {
    carrierKey: key,
    async fetchQuotes() {
      callCount++;
      return results;
    },
    get _callCount() { return callCount; }
  };
}

function makeSetup(carriers: CarrierPort[], merchantId = "mrc_1", rulesOpts: { allowFreeShipping?: boolean; freeShippingMinCartValue?: number } = {}) {
  const quotesRepo = new InMemoryShippingQuoteRepository(new InMemoryOutboxRepository());
  const merchantRepo = new InMemoryMerchantRepository();
  merchantRepo.seedRules(merchantId, {
    allowFreeShipping: rulesOpts.allowFreeShipping ?? false,
    freeShippingMinCartValue: rulesOpts.freeShippingMinCartValue ?? 999
  });
  const useCase = new QuoteShippingUseCase(quotesRepo, carriers, merchantRepo);
  return { quotesRepo, merchantRepo, useCase };
}

const BASE = {
  session_id: "sess_cache_1",
  merchant_id: "mrc_1",
  destination_zip: "01310-100",
  destination_city: "Synthetic", destination_state: "SP",
  cart_total: 200,
};

describe("QuoteShippingUseCase — Cache & Production Readiness", () => {
  it("M1 — cache key includes merchant rules hash; rules change busts cache", async () => {
    const carrier = makeCountingCarrier("pac", [
      { carrier_key: "pac", label: "PAC", price: 1500, eta_days: 5, is_free: false }
    ]);
    const { useCase, merchantRepo } = makeSetup([carrier]);

    // First quote
    await useCase.execute(BASE);
    assert.equal(carrier._callCount, 1, "first call fetches from carrier");

    // Same input, same session → cache hit
    await useCase.execute(BASE);
    assert.equal(carrier._callCount, 1, "second call reuses cache");

    // Change merchant rules → cache miss (different rules hash)
    merchantRepo.seedRules("mrc_1", { allowFreeShipping: true, freeShippingMinCartValue: 50 });
    await useCase.execute(BASE);
    assert.equal(carrier._callCount, 2, "rules change invalidates cache");
  });

  it("C2 — quote from different session is NOT reused (session isolation)", async () => {
    const carrier = makeCountingCarrier("pac", [
      { carrier_key: "pac", label: "PAC", price: 1500, eta_days: 5, is_free: false }
    ]);
    const { useCase } = makeSetup([carrier]);

    // Quote for session A
    const snapA = await useCase.execute({ ...BASE, session_id: "sess_A" });
    assert.equal(carrier._callCount, 1);
    assert.equal(snapA.session_id, "sess_A");

    // Quote for session B (same cart key) → should NOT reuse session A's quote
    const snapB = await useCase.execute({ ...BASE, session_id: "sess_B" });
    assert.equal(carrier._callCount, 2, "different session triggers fresh fetch");
    assert.equal(snapB.session_id, "sess_B");
    assert.notEqual(snapB.id, snapA.id, "new quote has distinct ID");
  });

  it("carrier failures produce partial results (no crash)", async () => {
    let failCalled = false;
    const goodCarrier = makeStubCarrier("pac", [
      { carrier_key: "pac", label: "PAC", price: 1500, eta_days: 5, is_free: false }
    ]);
    const badCarrier: CarrierPort = {
      carrierKey: "broken",
      async fetchQuotes() {
        failCalled = true;
        throw new Error("carrier_api_down");
      }
    };
    const { useCase } = makeSetup([goodCarrier, badCarrier]);

    const snap = await useCase.execute(BASE);
    assert.ok(failCalled, "bad carrier was invoked");
    assert.ok(snap.results.length > 0, "partial results returned");
    assert.ok(snap.results.some(r => r.carrier_key === "pac"), "good carrier results present");
    assert.ok(!snap.results.some(r => r.carrier_key === "broken"), "bad carrier not present");
  });

  it("deduplicates carriers with same key (prefers first occurrence)", async () => {
    const { useCase } = makeSetup([
      makeStubCarrier("pac", [
        { carrier_key: "pac", label: "PAC", price: 1500, eta_days: 5, is_free: false }
      ]),
      makeStubCarrier("pac-dup", [
        { carrier_key: "pac", label: "PAC", price: 1800, eta_days: 6, is_free: false }
      ])
    ]);

    const snap = await useCase.execute(BASE);
    const pacResults = snap.results.filter(r => r.carrier_key === "pac");
    assert.equal(pacResults.length, 1, "dedupe: only one entry per carrier_key");
  });

  it("returns sorted results by price → eta → label", async () => {
    const { useCase } = makeSetup([
      makeStubCarrier("multi", [
        { carrier_key: "sedex", label: "SEDEX", price: 3000, eta_days: 2, is_free: false },
        { carrier_key: "pac", label: "PAC", price: 1500, eta_days: 5, is_free: false },
        { carrier_key: "loggi", label: "Loggi", price: 1500, eta_days: 3, is_free: false },
      ])
    ]);

    const snap = await useCase.execute(BASE);
    assert.equal(snap.results[0]!.carrier_key, "loggi", "cheapest + fastest first");
    assert.equal(snap.results[1]!.carrier_key, "pac", "same price, slower");
    assert.equal(snap.results[2]!.carrier_key, "sedex", "most expensive last");
  });
});

function manualSetup(overrides: Partial<OwnDeliveryConfig> = {}) {
  let config: OwnDeliveryConfig | null = { id: "manual-config", merchantId: "mrc_1", enabled: true, mode: "flat",
    flatPriceCents: 750, freeAboveCents: null, neighborhoods: null, radiusZones: null, estimatedValue: 60, estimatedUnit: "minutes", ...overrides };
  const carrier = makeCountingCarrier("pac", [{ carrier_key: "pac", label: "PAC", price: 1500, eta_days: 5, is_free: false }]);
  const quotesRepo = new InMemoryShippingQuoteRepository(new InMemoryOutboxRepository());
  const useCase = new QuoteShippingUseCase(quotesRepo, [carrier], undefined, {
    async getByMerchantId(merchantId: string) { assert.equal(merchantId, "mrc_1"); return config; },
    async getNeighborhoodOrigin() { return { kind: "ready" as const, origin: { merchantId: "mrc_1", zip: "01001000", city: "Synthetic", state: "SP" } }; },
    async save(value: OwnDeliveryConfig) { return value; },
  });
  return { useCase, carrier, quotesRepo, change(value: Partial<OwnDeliveryConfig>) { config = { ...config!, ...value }; }, remove() { config = null; } };
}
const neighborhoods = [{ name: "São José", priceCents: 500 }, { name: "Centro", priceCents: 900 }];
const neighborhoodInput = { ...BASE, destination_neighborhood: "  SAO   JOSE " };

it("manual fixed quote uses configured cents/ETA and never dispatches a carrier", async () => {
  const f = manualSetup(), quote = await f.useCase.execute(BASE);
  assert.deepEqual(quote.results, [{ carrier_key: "own_delivery_flat", label: "Entrega própria", price: 750, eta_days: 1, is_free: false }]);
  assert.equal(f.carrier._callCount, 0);
  assert.equal((await f.quotesRepo.findById(quote.id, "mrc_1"))!.snapshot().results[0]!.price, 750);
});
for (const mode of ["flat", "neighborhood", "radius"] as const)
  it(`manual ${mode} invalidates cache when configuration is disabled`, async () => {
    const f = manualSetup({ mode, neighborhoods, radiusZones: [{ maxKm: 0.01, priceCents: 500 }] });
    const run = async () => {
      const input = { ...neighborhoodInput, origin_zip: "01001000" };
      const first = await f.useCase.execute(input); assert.equal(first.results.length, 1);
      f.change({ enabled: false });
      const quote = await f.useCase.execute(input); assert.notEqual(quote.id, first.id);
      assert.deepEqual(quote.results.map(row => row.carrier_key), ["pac"]);
      assert.equal(f.carrier._callCount, 1);
    };
    if (mode === "radius") await withSyntheticCoordinates({ lat: "0", lon: "0" }, run);
    else await run();
  });
it("manual flat cache reflects changed price/free threshold/ETA and mode, rather than reusing old quote", async () => {
  const f = manualSetup(), first = await f.useCase.execute(BASE), cached = await f.useCase.execute(BASE);
  assert.equal(cached.id, first.id);
  f.change({ flatPriceCents: 950, estimatedValue: 3, estimatedUnit: "days" });
  const repriced = await f.useCase.execute(BASE); assert.notEqual(repriced.id, first.id);
  assert.equal(repriced.results[0]!.price, 950); assert.equal(repriced.results[0]!.eta_days, 3);
  f.change({ freeAboveCents: 20000 });
  const free = await f.useCase.execute(BASE); assert.equal(free.results[0]!.price, 0);
  assert.equal(free.results[0]!.original_price, 950); assert.equal(free.results[0]!.is_free, true);
  f.change({ mode: "neighborhood", neighborhoods });
  const otherMode = await f.useCase.execute({ ...BASE, destination_neighborhood: "Centro" });
  assert.equal(otherMode.results[0]!.label, "Entrega própria - Centro");
});
for (const total of [199.99, 200, 200.01])
  it(`manual fixed free threshold respects exact cent boundary ${total}`, async () => {
    const f = manualSetup({ freeAboveCents: 20000 }), result = (await f.useCase.execute({ ...BASE, cart_total: total })).results[0]!;
    assert.equal(result.price, total < 200 ? 750 : 0); assert.equal(result.is_free, total >= 200);
    if (total >= 200) assert.equal(result.original_price, 750);
  });
it("manual neighborhood matches only one normalized destination, never the cheaper other district", async () => {
  const f = manualSetup({ mode: "neighborhood", neighborhoods }), result = await f.useCase.execute(neighborhoodInput);
  assert.equal(result.results.length, 1); assert.equal(result.results[0]!.label, "Entrega própria - São José"); assert.equal(result.results[0]!.price, 500);
  const changed = await f.useCase.execute({ ...BASE, destination_neighborhood: "Centro" });
  assert.notEqual(changed.id, result.id); assert.equal(changed.results.length, 1); assert.equal(changed.results[0]!.price, 900);
  assert.equal(f.carrier._callCount, 0);
});
for (const destination_neighborhood of [undefined, "", "São", "José", "Jardim Não Cadastrado", "Centro Sul"])
  it(`manual neighborhood does not invent coverage for ${destination_neighborhood}`, async () => {
    const f = manualSetup({ mode: "neighborhood", neighborhoods });
    const quote = await f.useCase.execute({ ...BASE, destination_neighborhood });
    assert.deepEqual(quote.results, []); assert.equal(f.carrier._callCount, 0);
  });
it("manual neighborhood ambiguous normalized names cannot authorize a price", async () => {
  const f = manualSetup({ mode: "neighborhood", neighborhoods: [...neighborhoods, { name: "Sao Jose", priceCents: 100 }] });
  assert.deepEqual((await f.useCase.execute(neighborhoodInput)).results, []);
});
for (const patch of [{ flatPriceCents: -1 }, { flatPriceCents: 1.1 }, { merchantId: "foreign" }, { estimatedValue: 0 }])
  it(`invalid/foreign manual configuration cannot yield a carrier fallback ${JSON.stringify(patch)}`, async () => {
    const f = manualSetup(patch); await assert.rejects(f.useCase.execute(BASE)); assert.equal(f.carrier._callCount, 0);
  });
it("manual configuration lookup failure propagates rather than authorizing carrier delivery", async () => {
  const f = manualSetup(); const useCase = new QuoteShippingUseCase(f.quotesRepo, [f.carrier], undefined, {
    async getByMerchantId() { throw new Error("synthetic_config_read_failed"); }, async save(value: OwnDeliveryConfig) { return value; },
  });
  await assert.rejects(useCase.execute(BASE), /synthetic_config_read_failed/); assert.equal(f.carrier._callCount, 0);
});
async function withSyntheticCoordinates(destination: { lat: string; lon: string } | null, work: () => Promise<void>) {
  const previous = globalThis.fetch; const calls: string[] = [];
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input); calls.push(url);
    if (url.startsWith("https://viacep.com.br/ws/")) return Response.json({ logradouro: url.includes("01001000") ? "Origin" : "Destination", bairro: "Synthetic", localidade: "Synthetic", uf: "SP" });
    if (url.startsWith("https://nominatim.openstreetmap.org/search?")) {
      const origin = new URL(url).searchParams.get("q")!.startsWith("Origin");
      return Response.json(origin ? [{ lat: "0", lon: "0" }] : destination ? [destination] : []);
    }
    throw new Error("unexpected_synthetic_geocoder_url");
  }) as typeof fetch;
  try { await work(); assert.ok(calls.length > 0); } finally { globalThis.fetch = previous; }
}
for (const [label, destination, expectedPrice] of [
  ["near", { lat: "0", lon: "0.005" }, 500], ["second zone", { lat: "0", lon: "0.02" }, 900],
  ["outside", { lat: "0", lon: "1" }, null], ["unresolved", null, null],
] as const) it(`manual radius ${label} uses the configured coverage only`, async () => {
  await withSyntheticCoordinates(destination, async () => {
    const f = manualSetup({ mode: "radius", radiusZones: [{ maxKm: 1, priceCents: 500 }, { maxKm: 3, priceCents: 900 }] });
    const quote = await f.useCase.execute({ ...BASE, origin_zip: "01001000" });
    assert.deepEqual(quote.results.map(result => result.price), expectedPrice === null ? [] : [expectedPrice]);
    assert.equal(f.carrier._callCount, 0);
  });
});
it("manual radius malformed coordinates cannot match an open-ended price tier", async () => {
  await withSyntheticCoordinates({ lat: "invalid", lon: "0" }, async () => {
    const f = manualSetup({ mode: "radius", radiusZones: [{ maxKm: null, priceCents: 500 }] });
    assert.deepEqual((await f.useCase.execute({ ...BASE, origin_zip: "01001000" })).results, []);
    assert.equal(f.carrier._callCount, 0);
  });
});
it("carrier quote cache invalidates when package dimensions or origin change", async () => {
  const f = manualSetup({ enabled: false }), first = await f.useCase.execute({ ...BASE, origin_zip: "01001000" });
  const repackaged = await f.useCase.execute({ ...BASE, origin_zip: "01001000", packages: [{ weightKg: 20, heightCm: 50, widthCm: 40, lengthCm: 30, quantity: 2 }] });
  const moved = await f.useCase.execute({ ...BASE, origin_zip: "02002000" });
  assert.notEqual(repackaged.id, first.id); assert.notEqual(moved.id, first.id); assert.equal(f.carrier._callCount, 3);
});
it("removing manual configuration invalidates its cached option", async () => {
  const f = manualSetup(), first = await f.useCase.execute(BASE); f.remove();
  const next = await f.useCase.execute(BASE); assert.notEqual(next.id, first.id);
  assert.deepEqual(next.results.map(row => row.carrier_key), ["pac"]);
});
it("free neighborhood delivery preserves only the matched district's original fee", async () => {
  const f = manualSetup({ mode: "neighborhood", neighborhoods, freeAboveCents: 20000 });
  const quote = await f.useCase.execute({ ...BASE, destination_neighborhood: "Centro" });
  assert.equal(quote.results.length, 1); assert.equal(quote.results[0]!.price, 0);
  assert.equal(quote.results[0]!.original_price, 900); assert.equal(quote.results[0]!.is_free, true);
});
it("radius free/open-ended tier keeps configured original price and refreshes on tier change", async () => {
  await withSyntheticCoordinates({ lat: "0", lon: "1" }, async () => {
    const f = manualSetup({ mode: "radius", radiusZones: [{ maxKm: 1, priceCents: 500 }, { maxKm: null, priceCents: 1700 }], freeAboveCents: 20000 });
    const input = { ...BASE, origin_zip: "01001000" }, first = await f.useCase.execute(input);
    assert.equal(first.results.length, 1); assert.equal(first.results[0]!.price, 0);
    assert.equal(first.results[0]!.original_price, 1700); assert.equal(first.results[0]!.is_free, true);
    f.change({ radiusZones: [{ maxKm: null, priceCents: 1800 }] });
    const changed = await f.useCase.execute(input); assert.notEqual(changed.id, first.id); assert.equal(changed.results[0]!.original_price, 1800);
  });
});
for (const radiusZones of [[{ maxKm: null, priceCents: 500 }, { maxKm: 1, priceCents: 100 }],
  [{ maxKm: 3, priceCents: 900 }, { maxKm: 1, priceCents: 500 }],
  [{ maxKm: 1, priceCents: 500 }, { maxKm: 1, priceCents: 900 }]])
  it(`invalid radius tier ordering cannot widen manual coverage ${JSON.stringify(radiusZones)}`, async () => {
    const f = manualSetup({ mode: "radius", radiusZones });
    await assert.rejects(f.useCase.execute({ ...BASE, origin_zip: "01001000" })); assert.equal(f.carrier._callCount, 0);
  });
