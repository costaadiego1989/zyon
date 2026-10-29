import test from "node:test";
import assert from "node:assert/strict";
import { quoteManualDelivery } from "./manual-delivery-quote.js";
import { resolveNeighborhoodDeliveryOrigin } from "./neighborhood-delivery-origin.js";

const config = { id: "config", merchantId: "merchant", enabled: true, mode: "neighborhood", flatPriceCents: 900,
  freeAboveCents: null, neighborhoods: [{ name: "Centro", priceCents: 1375 }], radiusZones: [{ maxKm: 10, priceCents: 500 }],
  estimatedValue: 1, estimatedUnit: "days" };
const source = { merchantId: "merchant", zip: "01001000", city: "São Paulo", state: "SP" };
const input = { cartTotalCents: 10000, neighborhood: " centro ", origin: source, destinationCity: " SAO  PAULO ", destinationState: "sp" };

test("neighborhood matches exact normalized origin city/UF and the matching district's tariff", () => {
  assert.equal(quoteManualDelivery(config, input as never)[0]!.price, 1375);
});
for (const [name, patch] of [
  ["homonymous district in another city", { destinationCity: "Campinas" }],
  ["same city name in another state", { destinationState: "RJ" }],
  ["partial city", { destinationCity: "São" }], ["city suffix", { destinationCity: "São Paulo Sul" }],
  ["missing destination city", { destinationCity: undefined }], ["missing state", { destinationState: undefined }],
  ["missing canonical origin", { origin: undefined }], ["foreign merchant origin", { origin: { ...source, merchantId: "foreign" } }],
  ["invalid origin UF", { origin: { ...source, state: "invalid" } }],
] as const) test(`neighborhood refuses ${name}, never another district or carrier fallback`, () => {
  assert.deepEqual(quoteManualDelivery(config, { ...input, ...patch } as never), []);
});
for (const mode of ["flat", "radius"] as const) test(`${mode} retains its existing tariff without city authority`, () => {
  assert.equal(quoteManualDelivery({ ...config, mode }, { cartTotalCents: 10000, radiusPriceCents: 500 })[0]!.price,
    mode === "flat" ? 900 : 500);
});

const merchant = { id: "merchant", storeSettings: { company: { address: { zip: "01001-000", city: "São Paulo", state: "sp" } } } };
const rule = { merchantId: "merchant", originZip: "01001000" };
test("configured company city/UF is bound to the same merchant's exact shipping-origin CEP", () => {
  assert.deepEqual(resolveNeighborhoodDeliveryOrigin("merchant", merchant, rule), { kind: "ready", origin: source });
});
for (const [name, company, rules] of [
  ["missing company", null, rule], ["foreign merchant", { ...merchant, id: "foreign" }, rule],
  ["foreign rules", merchant, { ...rule, merchantId: "foreign" }],
  ["another shipping origin", merchant, { ...rule, originZip: "99999000" }],
  ["missing shipping origin", merchant, { ...rule, originZip: null }],
  ["missing address", { ...merchant, storeSettings: {} }, rule],
  ["invalid origin city", { ...merchant, storeSettings: { company: { address: { ...merchant.storeSettings.company.address, city: "" } } } }, rule],
] as const) test(`origin ${name} is a typed configuration prerequisite, never inferred coverage`, () => {
  assert.deepEqual(resolveNeighborhoodDeliveryOrigin("merchant", company, rules), { kind: "needs_origin_address_configuration" });
});
