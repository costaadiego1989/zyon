import assert from "node:assert/strict";
import test from "node:test";
import { createCartHandlers, type CartHandlerDeps } from "./cart.handlers.js";
import { validateStorefrontToolOutput } from "../../domain/contracts/storefront-tool-output.schemas.js";
import { shippingReferenceUnavailable } from "../../domain/contracts/storefront-shipping-reference.schemas.js";

test("missing quote port cannot produce fake PAC/Sedex or create/update a cart", async () => {
  const deps = { cartRepo: { async getOrCreate() { assert.fail("read-only quote must not call getOrCreate"); } } } as unknown as CartHandlerDeps;
  const result = await createCartHandlers(deps, { merchantId: "merchant", sessionId: "conversation" }).quoteShipping({ zipCode: "01310100" });
  assert.deepEqual(result, shippingReferenceUnavailable("shipping_reference_unavailable"));
  assert.equal(validateStorefrontToolOutput("quote_shipping", result).ok, true);
});
test("handler snapshots authenticated scope, ignores no model authority and delegates only CEP/product request", async () => {
  const calls: unknown[] = [], deps = { shippingReference: { async quote(scope: unknown, request: unknown) {
    calls.push({ scope, request }); return shippingReferenceUnavailable("address_required");
  } } } as unknown as CartHandlerDeps;
  await createCartHandlers(deps, { merchantId: "merchant", sessionId: "cart", conversationId: "conversation", buyer: { globalUserId: "buyer" } })
    .quoteShipping({ cartId: "cart", zipCode: "01310-100" });
  assert.deepEqual(calls, [{ scope: { merchantId: "merchant", cartId: "cart", conversationId: "conversation", buyerId: "buyer" }, request: { zipCode: "01310-100" } }]);
});
test("foreign cart reference never substitutes the authenticated cart scope", async () => {
  const deps = { shippingReference: { async quote() { assert.fail("foreign reference must not reach canonical reader"); } } } as unknown as CartHandlerDeps;
  const result = await createCartHandlers(deps, { merchantId: "merchant", sessionId: "conversation" }).quoteShipping({ cartId: "foreign", zipCode: "01310100" });
  assert.deepEqual(result, shippingReferenceUnavailable("cart_review_required"));
});
test("malformed reference metadata cannot be sanitized into legacy successful options", () => {
  for (const referenceOnly of [undefined, null, false, "true"])
    assert.equal(validateStorefrontToolOutput("quote_shipping", { referenceOnly, options: [{ carrier: "fake", name: "Fake", price: 500, days: 2 }] }).ok, false);
});
