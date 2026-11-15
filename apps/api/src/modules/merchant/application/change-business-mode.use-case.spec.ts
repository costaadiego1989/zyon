import test from "node:test";
import assert from "node:assert/strict";
import { parseBusinessModeChange, isOpenCommercialCheckout } from "./change-business-mode.use-case.js";

test("T12", async t => {
  await t.test("ONB-04 requires the target and expected canonical modes", () => {
    assert.deepEqual(parseBusinessModeChange({ businessMode: "services", expectedBusinessMode: "products" }), { businessMode: "services", expectedBusinessMode: "products" });
    for (const input of [null, [], {}, { businessMode: "both", expectedBusinessMode: "products" },
      { businessMode: "products" }, { businessMode: "services", expectedBusinessMode: "products", merchantId: "foreign" }]) {
      assert.throws(() => parseBusinessModeChange(input));
    }
  });
  await t.test("REG-04 active canonical checkout survives inactivity until explicit closure", () => {
    const checkout = { cart: { items: [{ variantId: "food", quantity: 1 }] }, events: [] };
    assert.equal(isOpenCommercialCheckout(checkout), true);
    assert.equal(isOpenCommercialCheckout({ ...checkout, events: [{ eventName: "checkout_abandoned", metadata: { reason: "idle" } }] }), true);
    assert.equal(isOpenCommercialCheckout({ ...checkout, events: [{ eventName: "checkout_abandoned", metadata: { reason: "buyer_initiated" } }] }), false);
    assert.equal(isOpenCommercialCheckout({ cart: { items: [] }, events: [] }), false);
  });
});
