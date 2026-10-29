import test from "node:test";
import assert from "node:assert/strict";
import { BadRequestException } from "@nestjs/common";
import { AcpCouponApplier } from "./acp-coupon.applier.js";
import { checkoutSession } from "../../checkout/__tests__/checkout-test-fixtures.js";

test("ACP coupon forwards session scope and its version to atomic application", async () => {
  const calls: unknown[] = [];
  const applier = new AcpCouponApplier({ async executeForCheckout(input: unknown) { calls.push(input); } } as never);
  await applier.applyCoupon(checkoutSession({ merchantId: "store", sessionId: "one", persistenceVersion: 9 }), " PROMO ");
  assert.deepEqual(calls, [{ merchant_id: "store", session_id: "one", code: "PROMO", expectedVersion: 9 }]);
});

test("ACP coupon rejects an empty code", async () => {
  const applier = new AcpCouponApplier({ async executeForCheckout() { assert.fail("must not apply"); } } as never);
  await assert.rejects(applier.applyCoupon(checkoutSession(), "   "), BadRequestException);
});

test("ACP coupon propagates failed persistence", async () => {
  const applier = new AcpCouponApplier({ async executeForCheckout() { throw new Error("write_failed"); } } as never);
  await assert.rejects(applier.applyCoupon(checkoutSession(), "PROMO"), /write_failed/);
});
