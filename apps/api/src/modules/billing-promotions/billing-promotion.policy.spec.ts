import assert from "node:assert/strict";
import test from "node:test";
import { BadRequestException } from "@nestjs/common";
import { parsePromotion, parsePromotionQuery, promotionPolicy, promotionShouldBeActive } from "./billing-promotion.policy.js";

const now = new Date("2026-10-15T12:00:00Z");
const input = () => ({ id: "38e45af1-266e-4615-a618-186b614922e0", code: "blackfriday", name: "Black Friday", discountType: "percent", discountValue: 5000, duration: "repeating", durationMonths: 3, plans: ["starter179", "growth", "scale"], startsAt: "2026-11-27T03:00:00Z", expiresAt: "2026-12-01T02:59:00Z", maxRedemptions: 100, firstTimeOnly: true });

test("missing body is a validation failure", () => {
  for (const body of [null, undefined, []]) assert.throws(() => parsePromotion(body as any, now), BadRequestException);
});

test("malformed environment cannot bypass the minimum charge or month bounds", () => {
  assert.deepEqual(promotionPolicy({ BILLING_PROMOTION_MAX_MONTHS: "invalid", BILLING_PROMOTION_MIN_CHARGE_CENTS: "0" }), { maxMonths: 36, minChargeCents: 50 });
  assert.deepEqual(promotionPolicy({ BILLING_PROMOTION_MAX_MONTHS: "6", BILLING_PROMOTION_MIN_CHARGE_CENTS: "100" }), { maxMonths: 6, minChargeCents: 100 });
});

test("normalizes a 50% campaign for the first three monthly invoices with a separate redemption window", () => {
  const result = parsePromotion(input(), now);
  assert.equal(result.code, "BLACKFRIDAY"); assert.equal(result.discountValue, 5000);
  assert.equal(result.durationMonths, 3); assert.equal(result.duration, "repeating");
  assert.deepEqual(result.plans, ["growth", "scale", "starter179"]);
  assert.equal(result.expiresAt.toISOString(), "2026-12-01T02:59:00.000Z");
});
test("fixed R$178 off the Starter leaves a real first invoice of R$1", () => {
  const result = parsePromotion({ ...input(), discountType: "fixed", discountValue: 17800, plans: ["starter179"], duration: "once" }, now);
  assert.equal(result.discountValue, 17800); assert.equal(result.durationMonths, null);
});
test("accepts the BRL minimum of R$0.50 and zero for a fully discounted invoice", () => {
  assert.doesNotThrow(() => parsePromotion({ ...input(), discountType: "fixed", discountValue: 17850, plans: ["starter179"] }, now));
  assert.doesNotThrow(() => parsePromotion({ ...input(), discountValue: 10000 }, now));
});
for (const [field, value] of Object.entries({ code: "invalid space", id: "------------------------------------", discountType: "free_shipping", discountValue: 10001, duration: "invalid", durationMonths: 0, plans: ["starter"], maxRedemptions: 0, firstTimeOnly: "true", expiresAt: "2026-10-10T00:00:00Z", startsAt: "invalid" })) {
  test(`rejects invalid ${field}`, () => assert.throws(() => parsePromotion({ ...input(), [field]: value }, now), BadRequestException));
}
test("rejects discounts leaving less than the nonzero Stripe minimum or negative invoices", () => {
  for (const discountValue of [17851, 18000]) assert.throws(() => parsePromotion({ ...input(), discountType: "fixed", discountValue, plans: ["starter179"] }, now), BadRequestException);
});
test("a future start, pause, expiry, or exhausted limit prevents redemption activation", () => {
  const row = { ...parsePromotion(input(), now), enabled: true };
  assert.equal(promotionShouldBeActive(row, 0, now), false);
  const activeTime = new Date("2026-11-28T10:00:00Z");
  assert.equal(promotionShouldBeActive(row, 99, activeTime), true);
  assert.equal(promotionShouldBeActive(row, 100, activeTime), false);
  assert.equal(promotionShouldBeActive({ ...row, enabled: false }, 0, activeTime), false);
  assert.equal(promotionShouldBeActive(row, 0, row.expiresAt), false);
});
test("filters are bounded, exclude deleted coupons and search both name and code", () => {
  const result = parsePromotionQuery({ search: " black ", status: "disabled", discountType: "fixed", plan: "scale", page: "2", pageSize: "25" }, now);
  assert.equal(result.page, 2); assert.equal(result.pageSize, 25);
  assert.equal(result.where.deletedAt, null); assert.equal(result.where.enabled, false);
  assert.equal(result.where.discountType, "fixed"); assert.deepEqual(result.where.plans, { has: "scale" });
  assert.deepEqual(result.where.OR?.map(item => Object.values(item)[0]), [{ contains: "black", mode: "insensitive" }, { contains: "black", mode: "insensitive" }]);
});
test("invalid pagination and unknown filters are rejected", () => {
  for (const query of [{ page: 0 }, { pageSize: 1000 }, { page: 1.5 }, { status: "anything" }, { plan: "starter" }, { discountType: "free_shipping" }]) assert.throws(() => parsePromotionQuery(query, now), BadRequestException);
});
