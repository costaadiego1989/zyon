import test from "node:test";
import assert from "node:assert/strict";
import { evaluateSelectedNeighborhoodDelivery, type SelectedNeighborhoodDeliveryInput } from "./selected-neighborhood-delivery.js";
import { toCheckoutShippingQuote } from "./checkout-shipping-quote.mapper.js";

function fixture(chat = false): SelectedNeighborhoodDeliveryInput {
  const option = { carrier_key: "own_delivery_neighborhood_centro", label: "Entrega própria - Centro", price: 1375, eta_days: 1, is_free: false };
  return { merchantId: "merchant", sessionId: "session", cartTotalCents: 10000,
    config: { id: "config", merchantId: "merchant", enabled: true, mode: "neighborhood", flatPriceCents: null,
      freeAboveCents: null, neighborhoods: [{ name: "Centro", priceCents: 1375 }], radiusZones: null, estimatedValue: 1, estimatedUnit: "days" },
    origin: { kind: "ready", origin: { merchantId: "merchant", zip: "01001000", city: "São Paulo", state: "SP" } },
    addressVerified: true, address: { zip: "01002000", street: "Synthetic", number: "1", complement: "", neighborhood: "Centro", city: "SAO PAULO", state: "SP" },
    selected: chat ? toCheckoutShippingQuote({ label: option.label, carrierKey: option.carrier_key, priceInCents: option.price,
      realCostInCents: option.price, isFree: option.is_free, etaDays: option.eta_days, destinationZip: "01002-000" })
      : { carrier: option.carrier_key, method: option.label, customerPrice: 13.75, deliveryDays: 1, destinationZip: "01002000" },
    sourceQuote: { merchant_id: "merchant", session_id: "session", destination_zip: "01002000", results: [option] } };
}

for (const chat of [false, true]) {
  test(`${chat ? "chat exact mapper" : "HTTP exact namespace"} permits the current same-origin city tariff`, () => {
    assert.deepEqual(evaluateSelectedNeighborhoodDelivery(fixture(chat)), { kind: "authorized" });
  });
  for (const fault of ["city", "state", "unverified", "zip", "price", "eta", "missing-quote", "foreign-merchant", "foreign-session", "ambiguous", "changed-tariff", "no-origin"] as const)
    test(`${chat ? "chat" : "HTTP"} rejects ${fault} without altering saved values or reading analytic cost`, () => {
      const input = fixture(chat);
      if (fault === "city") input.address!.city = "Campinas";
      if (fault === "state") input.address!.state = "RJ";
      if (fault === "unverified") input.addressVerified = false;
      if (fault === "zip") input.address!.zip = "99999000";
      if (fault === "price") input.selected!.customerPrice = 0;
      if (fault === "eta") input.selected!.deliveryDays = 2;
      if (fault === "missing-quote") input.sourceQuote = null;
      if (fault === "foreign-merchant") input.sourceQuote!.merchant_id = "foreign";
      if (fault === "foreign-session") input.sourceQuote!.session_id = "foreign";
      if (fault === "ambiguous") input.sourceQuote!.results.push({ ...input.sourceQuote!.results[0]! });
      if (fault === "changed-tariff") (input.config as { neighborhoods: Array<{ priceCents: number }> }).neighborhoods[0]!.priceCents++;
      if (fault === "no-origin") input.origin = { kind: "needs_origin_address_configuration" };
      const before = structuredClone(input);
      assert.equal(evaluateSelectedNeighborhoodDelivery(input).kind, "requires_review");
      assert.deepEqual(input, before);
    });
}

test("realCost is not read or used as locality authority", () => {
  const input = fixture(true);
  Object.defineProperty(input.selected!, "realCost", { get() { throw new Error("analytic_cost_must_not_be_read"); } });
  assert.deepEqual(evaluateSelectedNeighborhoodDelivery(input), { kind: "authorized" });
});
for (const carrier of ["PAC", "own_delivery_flat", "own_delivery_radius"]) test(`${carrier} is not blocked by neighborhood configuration or another city`, () => {
  const input = fixture(); input.address!.city = "Another city"; input.origin = undefined;
  input.selected = { carrier, method: "Other delivery", customerPrice: 9 };
  assert.deepEqual(evaluateSelectedNeighborhoodDelivery(input), { kind: "not_neighborhood" });
});
test("no selected delivery remains unselected rather than assuming neighborhood coverage", () => {
  const input = fixture(); input.selected = null; input.origin = undefined;
  assert.deepEqual(evaluateSelectedNeighborhoodDelivery(input), { kind: "not_neighborhood" });
});
test("lone manual carrier or stale mapping is typed review, not a proven carrier fallback", () => {
  const input = fixture(true); input.selected!.method = undefined;
  assert.deepEqual(evaluateSelectedNeighborhoodDelivery(input), { kind: "requires_review", reason: "neighborhood_quote_review_required" });
});

test("early classification cannot mark chat Entrega safe before canonical configuration and quote are loaded", () => {
  const input = fixture(true); input.config = undefined; input.sourceQuote = null; input.origin = undefined;
  assert.deepEqual(evaluateSelectedNeighborhoodDelivery(input), { kind: "requires_review", reason: "neighborhood_quote_review_required" });
});
for (const mode of ["flat", "radius"] as const) test(`chat ${mode} needs its exact owned source before it is classified as another manual mode`, () => {
  const input = fixture(true); const option = { carrier_key: `own_delivery_${mode}`, label: "Entrega própria", price: 900, eta_days: 1, is_free: false };
  (input.config as { mode: string }).mode = mode;
  input.selected = toCheckoutShippingQuote({ label: option.label, carrierKey: option.carrier_key, priceInCents: 900,
    realCostInCents: 900, isFree: false, etaDays: 1, destinationZip: "01002000" });
  input.sourceQuote!.results = [option];
  assert.deepEqual(evaluateSelectedNeighborhoodDelivery(input), { kind: "not_neighborhood" });
  input.sourceQuote = null;
  assert.equal(evaluateSelectedNeighborhoodDelivery(input).kind, "requires_review");
});
