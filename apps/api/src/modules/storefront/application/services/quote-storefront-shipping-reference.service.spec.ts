import assert from "node:assert/strict";
import test from "node:test";
import { QuoteStorefrontShippingReferenceService } from "./quote-storefront-shipping-reference.service.js";
import type { StorefrontShippingReferenceAuthority } from "../../domain/ports/storefront-shipping-reference.port.js";
import { storefrontShippingReferenceRequestSchema, storefrontShippingReferenceResultSchema } from "../../domain/contracts/storefront-shipping-reference.schemas.js";

function fixture() {
  const scope = { merchantId: "merchant", cartId: "conversation", conversationId: "conversation", buyerId: "buyer" };
  const current: Extract<StorefrontShippingReferenceAuthority, { kind: "ready" }> = { kind: "ready", basisHash: "a".repeat(64), configurationHash: "b".repeat(64),
    cartTotalCents: 11800, originZip: "01001000", destinationZip: "01310100", destinationNeighborhood: "Saved district", addressSource: "saved_buyer_address",
    mode: "neighborhood", items: [{ sku: "SKU", quantity: 2 }] };
  const state = { reads: 0, calls: 0, changed: "", unavailable: false };
  const reader = { async read() { state.reads++; return state.unavailable ? { kind: "unavailable" as const, reason: "address_required" as const }
    : { ...structuredClone(current), ...(state.reads > 1 && state.changed ? { [state.changed]: "c".repeat(64) } : {}) }; } };
  const shipping = { async executeReference(input: unknown) { state.calls++;
    assert.deepEqual(input, { session_id: "conversation", merchant_id: "merchant", destination_zip: "01310100", destination_neighborhood: "Saved district",
      cart_total: 118, origin_zip: "01001000", items: [{ sku: "SKU", quantity: 2 }], basisHash: current.basisHash, configurationHash: current.configurationHash });
    return { referenceOnly: true as const, id: "11111111-1111-4111-8111-111111111111", expiresAt: new Date(Date.now() + 600000).toISOString(),
      basisHash: current.basisHash, configurationHash: current.configurationHash,
      results: [{ carrier_key: "own_delivery_neighborhood_saved", label: "Entrega própria", price: 900, eta_days: 1, is_free: false }] }; } };
  return { scope, current, state, service: new QuoteStorefrontShippingReferenceService(reader, shipping) };
}
test("reference delegates only canonical cart/address/packages, rereads after IO and preserves existing options DTO", async () => {
  const f = fixture(), result = await f.service.quote(f.scope, { zipCode: "01310-100" });
  assert.equal(f.state.reads, 2); assert.equal(f.state.calls, 1); assert.equal(result.referenceOnly, true);
  assert.deepEqual(result.options, [{ carrier: "own_delivery_neighborhood_saved", name: "Entrega própria", price: 900, days: 1, zipCode: "01310100" }]);
  assert.equal(result.reference!.addressSource, "saved_buyer_address"); assert.deepEqual(storefrontShippingReferenceResultSchema.parse(result), result);
  assert.equal(JSON.stringify(result).includes("Saved district"), false);
});
for (const changed of ["basisHash", "configurationHash"])
  test(`${changed} changed during remote quote returns review instead of stale methods`, async () => {
    const f = fixture(); f.state.changed = changed; const result = await f.service.quote(f.scope, { zipCode: "01310100" });
    assert.equal(result.reason, "source_changed"); assert.deepEqual(result.options, []); assert.equal(result.reference, undefined);
  });
test("missing canonical address yields prerequisite without contacting a carrier", async () => {
  const f = fixture(); f.state.unavailable = true; const result = await f.service.quote(f.scope, { zipCode: "01310100" });
  assert.equal(result.reason, "address_required"); assert.equal(f.state.calls, 0);
});
test("request schema refuses model total, packages, neighborhood and forged checkout ID", () => {
  for (const key of ["cart_total", "total", "packages", "destination_neighborhood", "neighborhood", "checkoutId", "merchantId"])
    assert.equal(storefrontShippingReferenceRequestSchema.safeParse({ zipCode: "01310100", [key]: "forged" }).success, false);
});
