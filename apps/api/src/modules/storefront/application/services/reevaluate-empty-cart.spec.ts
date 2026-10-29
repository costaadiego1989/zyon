import assert from "node:assert/strict";
import test from "node:test";
import { reevaluateCartRules } from "./reevaluate-cart-rules.js";

test("viewing an empty cart without a benefit never invents a revocation notice or writes commercial state", async () => {
  const original = { merchantId: "merchant-a", sessionId: "cart-a", items: [], total: 0, discount: 0, couponCode: null, freeShipping: false };
  const unavailable = new Proxy({}, { get: () => assert.fail("an empty cart without benefits needs no pricing, policy, or persistence") });
  const result = await reevaluateCartRules({ prisma: unavailable, merchantRepo: unavailable, cartRepo: unavailable } as any, "merchant-a", "cart-a", original as any);
  assert.deepEqual(result.cart.items, []); assert.equal(result.cart.total, 0);
  assert.deepEqual(result.cart.commercialNotices, []);
  assert.deepEqual(result.activeRules, []); assert.equal(result.nextNudge, null);
  assert.equal(Object.hasOwn(original, "commercialNotices"), false);
  await assert.rejects(reevaluateCartRules({} as any, "other-merchant", "cart-a", original as any), /discount_price_review_required/);
});
