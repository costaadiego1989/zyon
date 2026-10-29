import { test } from "node:test";
import assert from "node:assert/strict";
import { refundShippingCents } from "./refund-shipping.js";
import { marketplaceReturnShipping } from "../../modules/marketplace/domain/services/marketplace-refund-allocation.js";

test("partial returns conserve every original freight cent cumulatively", () => {
  let returned = 0, refunded = 0;
  for (const expected of [333, 333, 334]) {
    const amount = refundShippingCents({ originalCents: 1000, orderedQuantity: 3, returnedQuantity: 1,
      previouslyReturnedQuantity: returned, previouslyRefundedCents: refunded });
    assert.equal(amount, expected); returned++; refunded += amount;
  }
  assert.equal(refunded, 1000);
});
test("full returns and free freight preserve the original buyer charge", () => {
  assert.equal(refundShippingCents({ originalCents: 1990, orderedQuantity: 2, returnedQuantity: 2 }), 1990);
  assert.equal(refundShippingCents({ originalCents: 0, orderedQuantity: 2, returnedQuantity: 1 }), 0);
});
test("invalid identities and over-returning cannot authorize freight", () => {
  for (const returnedQuantity of [0, -1, 0.5, 4, NaN]) assert.throws(() => refundShippingCents({ originalCents: 1000,
    orderedQuantity: 3, returnedQuantity }), /refund_shipping_identity_invalid/);
});
test("marketplace freight is calculated separately per original seller", () => {
  const base: any = { instructions: { shipping: [{ merchantId: "seller-a", amountCents: 1000 }, { merchantId: "seller-b", amountCents: 1990 }] },
    budget: { lines: [{ lineItemId: "a", sellerMerchantId: "seller-a" }, { lineItemId: "b", sellerMerchantId: "seller-b" }] },
    identities: [{ lineItemId: "a", variantId: "va", quantity: 3 }, { lineItemId: "b", variantId: "vb", quantity: 1 }], previous: [] };
  assert.deepEqual(marketplaceReturnShipping({ ...base, items: [{ variantId: "va", quantity: 1 }] }), [{ merchantId: "seller-a", amountCents: 333 }]);
  assert.deepEqual(marketplaceReturnShipping({ ...base, items: [{ variantId: "vb", quantity: 1 }] }), [{ merchantId: "seller-b", amountCents: 1990 }]);
  assert.deepEqual(marketplaceReturnShipping({ ...base, items: [{ variantId: "va", quantity: 2 }], previous: [{ lines: [{ sellerMerchantId: "seller-a", quantity: 1 }],
    shipping: [{ merchantId: "seller-a", amountCents: 0 }] }] }), [{ merchantId: "seller-a", amountCents: 1000 }]);
});
