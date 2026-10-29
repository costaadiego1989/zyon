import assert from "node:assert/strict";
import test from "node:test";
import { crossSellIntentV1Schema, crossSellPercentageSchema, crossSellQuoteCandidateInputSchema, crossSellQuoteCandidateResultSchema } from "./cross-sell-quote.schemas.js";

const intent = () => ({ version: 1, promotionId: "promotion", promotionUpdatedAt: "2026-10-18T00:00:00.000Z", acceptedQuantity: 2, originalUnitPriceCents: 10000 });

test("cross-sell intent is strict versioned provenance, detached from its caller", () => {
  const input = intent(), parsed = crossSellIntentV1Schema.parse(input);
  assert.deepEqual(parsed, input); assert.notEqual(parsed, input);
  input.acceptedQuantity = 99; assert.equal(parsed.acceptedQuantity, 2);
});

for (const patch of [{ version: 2 }, { merchantId: "foreign" }, { price: 1 }, { discountPercent: "100" }, { promotionUpdatedAt: "invalid" },
  { promotionId: " " }, { promotionId: "a\0b" }, { promotionId: "\ud800" }, { promotionId: "x".repeat(192) },
  { acceptedQuantity: 0 }, { acceptedQuantity: 1.5 }, { acceptedQuantity: 100 }, { originalUnitPriceCents: -1 }, { originalUnitPriceCents: 0.1 },
  { originalUnitPriceCents: Number.MAX_SAFE_INTEGER + 1 }]) test(`strict intent rejects unsupported authority/shape ${JSON.stringify(patch)}`, () => {
  assert.equal(crossSellIntentV1Schema.safeParse({ ...intent(), ...patch }).success, false);
});

for (const value of ["0", "0.0000", "0.0001", "12.3456", "100", "100.0000"]) test(`exact Decimal(12,4) percentage preserves ${value}`, () => {
  assert.equal(crossSellPercentageSchema.parse(value), value);
});
for (const value of [12.3456, "-1", "-0", "+1", "1e2", "1E-4", "NaN", "Infinity", "100.0001", "100000000.0000", "12.34567", "001", " 1", "1 ", "1\n", ".5", "1."])
  test(`decimal rejects coercion/precision/range ${String(value)}`, () => assert.equal(crossSellPercentageSchema.safeParse(value).success, false));

test("result is a candidate or unavailable, never an economic grant or exposed cause", () => {
  assert.equal(crossSellQuoteCandidateResultSchema.safeParse({ kind: "candidate", source: "cross_sell", promotionId: "promotion", unitPriceCents: 9000, unitDiscountCents: 1000 }).success, true);
  for (const extra of [{ approved: true }, { capPercent: 30 }, { cost: 10 }, { marginApproved: true }]) {
    assert.equal(crossSellQuoteCandidateResultSchema.safeParse({ kind: "candidate", source: "base", unitPriceCents: 10000, unitDiscountCents: 0, ...extra }).success, false);
  }
  assert.equal(crossSellQuoteCandidateResultSchema.safeParse({ kind: "unavailable", reason: "tenant_mismatch", cause: "secret" }).success, false);
  assert.equal(crossSellQuoteCandidateResultSchema.safeParse({ kind: "candidate", source: "base", promotionId: "promotion", unitPriceCents: 100, unitDiscountCents: 0 }).success, false);
});

test("input requires explicit persisted-cart provenance and evaluation timestamp", () => {
  assert.equal(crossSellQuoteCandidateInputSchema.safeParse({ intent: intent() }).success, false);
  assert.equal(crossSellQuoteCandidateInputSchema.safeParse({ intent: intent(), viewedProduct: "product", now: "2026-10-18T00:00:00.000Z" }).success, false);
});

