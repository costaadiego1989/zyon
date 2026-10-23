import assert from "node:assert/strict";
import test from "node:test";
import { QuoteShippingUseCase, shippingReferenceConfigurationHash } from "./quote-shipping.use-case.js";
import type { OwnDeliveryConfig } from "../../domain/ports/own-delivery-config.port.js";
import type { CarrierPort } from "../../domain/ports/carrier.port.js";
import { ShippingQuotesModule } from "../../shipping-quotes.module.js";
import { SHIPPING_REFERENCE_CARRIERS } from "../../domain/ports/carrier.port.js";

function fixture(manual: Partial<OwnDeliveryConfig> | null = null) {
  const state = { calls: 0, config: manual === null ? null : { id: "config", merchantId: "merchant", enabled: true, mode: "flat",
    flatPriceCents: 900, freeAboveCents: null, neighborhoods: null, radiusZones: null, estimatedValue: 60, estimatedUnit: "minutes", ...manual } as OwnDeliveryConfig };
  const live: CarrierPort = { carrierKey: "merchant-real", async fetchQuotes(context) {
    state.calls++; assert.equal(context.merchantId, "merchant"); assert.equal(context.packages[0]!.weightKg, 0.7);
    assert.equal(context.packages[0]!.quantity, 2);
    return [{ carrier_key: "real:service", label: "Real merchant service", price: 1937, eta_days: 4, is_free: false }];
  } };
  const forbidden = async () => { assert.fail("reference must not cache/persist/select/provision defaults or use general fallback carriers"); };
  const repository = { findValidByKey: forbidden, saveWithEvents: forbidden } as never;
  const general: CarrierPort = { carrierKey: "flat-rate", fetchQuotes: forbidden };
  const useCase = new QuoteShippingUseCase(repository, [general], { getRules: forbidden } as never,
    { async getByMerchantId() { return structuredClone(state.config); }, save: forbidden,
      async getNeighborhoodOrigin() { return { kind: "ready" as const, origin: { merchantId: "merchant", zip: "01001000", city: "Synthetic", state: "SP" } }; } }, [live]);
  const input = { session_id: "conversation", merchant_id: "merchant", destination_zip: "01310100", cart_total: 118,
    origin_zip: "01001000", destination_city: "Synthetic", destination_state: "SP", packages: [{ weightKg: 0.7, heightCm: 8, widthCm: 10, lengthCm: 12, quantity: 2 }],
    items: [{ sku: "SKU", quantity: 2 }], basisHash: "a".repeat(64), configurationHash: shippingReferenceConfigurationHash(state.config, "01001000",
      { merchantId: "merchant", zip: "01001000", city: "Synthetic", state: "SP" }) };
  return { state, useCase, input, live };
}
test("reference live carrier preserves exact packages/quantity/cents without cache, quote persistence or inferred free-shipping", async () => {
  const f = fixture(), result = await f.useCase.executeReference(f.input);
  assert.equal(result.referenceOnly, true); assert.equal(result.results[0]!.price, 1937); assert.equal(result.results[0]!.is_free, false);
  assert.equal(f.state.calls, 1); assert.equal("quote_key" in result, false); assert.equal("selected_carrier_key" in result, false);
});
for (const missing of ["dimensions", "origin", "account"] as const)
  test(`reference missing ${missing} never fabricates a box or PAC/Sedex fallback`, async () => {
    const f = fixture();
    if (missing === "dimensions") Reflect.deleteProperty(f.input, "packages");
    if (missing === "origin") { f.input.origin_zip = ""; f.input.configurationHash = shippingReferenceConfigurationHash(null, ""); }
    if (missing === "account") f.live.fetchQuotes = async () => [];
    const result = await f.useCase.executeReference(f.input); assert.deepEqual(result.results, []);
    assert.equal(result.reason, missing === "dimensions" ? "dimensions_required" : missing === "origin" ? "origin_required" : "carrier_unavailable");
  });
test("manual flat quote reuses configured raw tariff, never granting free-above policy from a reference", async () => {
  const f = fixture({ freeAboveCents: 100 }); Reflect.deleteProperty(f.input, "packages");
  const result = await f.useCase.executeReference(f.input); assert.equal(result.results[0]!.price, 900); assert.equal(result.results[0]!.is_free, false);
  assert.equal(f.state.calls, 0);
});
test("manual neighborhood requires canonical neighborhood and has no fallback on unknown coverage", async () => {
  const f = fixture({ mode: "neighborhood", flatPriceCents: null, neighborhoods: [{ name: "Centro", priceCents: 500 }] });
  assert.equal((await f.useCase.executeReference(f.input)).reason, "address_required");
  const covered = await f.useCase.executeReference({ ...f.input, destination_neighborhood: "CENTRO" }); assert.equal(covered.results[0]!.price, 500);
  const absent = await f.useCase.executeReference({ ...f.input, destination_neighborhood: "Another" });
  assert.equal(absent.reason, "coverage_unavailable"); assert.deepEqual(absent.results, []); assert.equal(f.state.calls, 0);
});
test("changed manual config invalidates the canonical reference before carrier IO", async () => {
  const f = fixture({}); f.state.config!.flatPriceCents = 901;
  const result = await f.useCase.executeReference(f.input); assert.equal(result.reason, "source_changed"); assert.deepEqual(result.results, []);
});
test("reference does not accept a carrier-authored free-shipping grant", async () => {
  const f = fixture(); f.live.fetchQuotes = async () => [{ carrier_key: "real", label: "Unauthorized free", price: 0, eta_days: 1, is_free: true }];
  await assert.rejects(f.useCase.executeReference(f.input));
});
test("manual radius uses existing geocode/distance math with no invented price outside configured coverage", async t => {
  const f = fixture({ mode: "radius", flatPriceCents: null, radiusZones: [{ maxKm: 1, priceCents: 725 }] });
  const original = globalThis.fetch; t.after(() => { globalThis.fetch = original; });
  let latitude = "0";
  globalThis.fetch = (async (raw: string | URL | Request) => {
    const url = String(raw); return { ok: true, async json() { return url.includes("viacep.com.br")
      ? { logradouro: "Synthetic", bairro: "Synthetic", localidade: "Synthetic", uf: "SP" } : [{ lat: latitude, lon: "0" }]; } } as Response;
  }) as typeof fetch;
  assert.equal((await f.useCase.executeReference(f.input)).results[0]!.price, 725);
  let calls = 0; globalThis.fetch = (async (raw: string | URL | Request) => { calls++;
    if (String(raw).includes("viacep.com.br")) return { ok: true, async json() { return { logradouro: "Synthetic", bairro: "Synthetic", localidade: "Synthetic", uf: "SP" }; } } as Response;
    latitude = calls < 3 ? "0" : "10"; return { ok: true, async json() { return [{ lat: latitude, lon: "0" }]; } } as Response;
  }) as typeof fetch;
  const result = await f.useCase.executeReference(f.input); assert.deepEqual(result.results, []); assert.equal(result.reason, "coverage_unavailable");
});
test("DI dedicated real-carrier wrapper requires merchant account without global fallback", async () => {
  const providers: Array<{ provide?: unknown; useFactory?: (carrier: unknown) => CarrierPort[] }> = Reflect.getMetadata("providers", ShippingQuotesModule);
  const provider = providers.find(item => typeof item === "object" && item.provide === SHIPPING_REFERENCE_CARRIERS)!;
  assert.equal(typeof provider?.useFactory, "function"); let options: unknown;
  const carriers = provider.useFactory!({ carrierKey: "melhor-envio", async fetchQuotes(_context: unknown, received: unknown) { options = received; return []; } });
  await carriers[0]!.fetchQuotes({ merchantId: "merchant", originZip: "01001000", destinationZip: "01310100", cartTotalCents: 100, packages: [] });
  assert.deepEqual(options, { requireMerchantAccount: true });
});
