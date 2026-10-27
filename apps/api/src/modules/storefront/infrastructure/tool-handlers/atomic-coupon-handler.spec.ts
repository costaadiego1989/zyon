import assert from "node:assert/strict";
import test from "node:test";
import { createCartHandlers, type CartHandlerDeps } from "./cart.handlers.js";
import { StorefrontToolOutcomeUnknownError } from "../../domain/errors/store-tool-outcome-unknown.error.js";
import type { StorefrontCouponCartPort } from "../../domain/ports/storefront-coupon-cart.port.js";
const ctx = { merchantId: "merchant", sessionId: "owned-cart", buyer: { globalUserId: "verified-buyer" } };
function fixture(couponCart?: StorefrontCouponCartPort) {
  const deps = new Proxy({} as CartHandlerDeps, { get(_target, key) {
    if (key === "couponCart") return couponCart;
    assert.fail(`atomic_handler_must_not_access_legacy_${String(key)}`);
  } });
  return createCartHandlers(deps, ctx);
}
test("atomic coupon handler never falls back to a separately committed reservation when port absent", async () => {
  assert.deepEqual(await fixture().applyCoupon({ couponCode: "COUPON" }), { applied: false, reason: "coupon_service_unavailable" });
});
test("atomic coupon handler delegates only authenticated scope and trusted buyer; preserves current envelope", async () => {
  let calls = 0;
  const result = await fixture({ apply: async (scope, input) => { calls++; assert.deepEqual(scope, { merchantId: "merchant", cartId: "owned-cart" });
    assert.deepEqual(input, { code: "COUPON", trustedBuyerGlobalUserId: "verified-buyer" }); return { applied: false, reason: "COUPON_EXPIRED" }; } })
    .applyCoupon({ couponCode: "COUPON", cartId: "foreign" } as never);
  assert.deepEqual(result, { applied: false, reason: "COUPON_EXPIRED" }); assert.equal(calls, 1);
});
for (const failure of [new Error("PRIVATE_database_ack_lost"), null, 0]) test(`atomic coupon unknown failure never becomes a known rejection or retry (${String(failure)})`, async () => {
  let calls = 0;
  await assert.rejects(fixture({ apply: async () => { calls++; throw failure; } }).applyCoupon({ couponCode: "COUPON" }), error => error instanceof StorefrontToolOutcomeUnknownError);
  assert.equal(calls, 1);
});

