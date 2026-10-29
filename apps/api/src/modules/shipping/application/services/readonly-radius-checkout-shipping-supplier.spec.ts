import test from "node:test";
import assert from "node:assert/strict";
import { ReadonlyRadiusCheckoutShippingSupplier } from "./readonly-radius-checkout-shipping-supplier.js";
import type { ReadonlyCheckoutShippingRequest } from "../../domain/ports/readonly-checkout-shipping-supplier.port.js";

const config = { id: "own", merchantId: "merchant", enabled: true, mode: "radius", flatPriceCents: null,
  freeAboveCents: 0, neighborhoods: null, radiusZones: [{ maxKm: 5, priceCents: 700 }], estimatedValue: 60, estimatedUnit: "minutes" };
const request: ReadonlyCheckoutShippingRequest = { requestId: "7ddca159-7f78-49ba-b060-d0af0e074b18", merchantId: "merchant", mode: "radius",
  originZip: "01310000", destinationZip: "02010000", metadataHash: "a".repeat(64), expiresAt: "2026-10-20T12:01:00.000Z", config };
test("radius returns configured raw tariff, not free benefit or invented cost", async () => {
  const calls: string[] = [];
  const supplier = new ReadonlyRadiusCheckoutShippingSupplier(async zip => { calls.push(zip); return { lat: -23.5, lng: -46.6 }; });
  const result = await supplier.quote(request);
  assert.deepEqual(calls, ["01310000", "02010000"]);
  assert.equal(result.mode, "radius");
  assert.equal(result.options[0]!.price, 700);
  assert.equal(result.options[0]!.eta_days, 1);
  assert.equal("realCost" in result.options[0]!, false);
  assert.equal("is_free" in result.options[0]!, false);
  assert.equal(result.evidence.kind, "cep_haversine");
});
test("outside configured radius is a confirmed empty quote, never guessed flat fallback", async () => {
  const supplier = new ReadonlyRadiusCheckoutShippingSupplier(async zip => zip === "01310000" ? { lat: 0, lng: 0 } : { lat: 40, lng: 40 });
  const result = await supplier.quote(request);
  assert.deepEqual(result.options, []);
});
for (const point of [null, { lat: NaN, lng: 0 }, { lat: 91, lng: 0 }, { lat: 0, lng: Infinity }]) {
  test(`geocoder unproven coordinates refuse: ${JSON.stringify(point)}`, async () => {
    await assert.rejects(new ReadonlyRadiusCheckoutShippingSupplier(async () => point as never).quote(request));
  });
}
for (const changed of [{ expiresAt: "not-a-time" }, { metadataHash: "body-hash" }, { originZip: "bad" },
  { config: { ...config, merchantId: "foreign" } }, { config: { ...config, enabled: false } }, { config: { ...config, mode: "flat" } }]) {
  test(`invalid canonical request refuses before geocoder: ${JSON.stringify(changed)}`, async () => {
    let calls = 0;
    await assert.rejects(new ReadonlyRadiusCheckoutShippingSupplier(async () => { calls++; return { lat: 0, lng: 0 }; }).quote({ ...request, ...changed }));
    assert.equal(calls, 0);
  });
}
test("geocoder failure propagates for durable unknown without fallback or retry", async () => {
  let calls = 0;
  await assert.rejects(new ReadonlyRadiusCheckoutShippingSupplier(async () => { calls++; throw Error("geocoder_unavailable"); }).quote(request), /geocoder_unavailable/);
  assert.equal(calls, 1);
});
