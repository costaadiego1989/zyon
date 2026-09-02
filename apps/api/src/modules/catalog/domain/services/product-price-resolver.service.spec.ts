import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  resolveEffectiveUnitPrice,
  type ActivePromotion,
} from "./product-price-resolver.service.js";

describe("resolveEffectiveUnitPrice", () => {
  it("returns base price with no discount fields when no promo", () => {
    const result = resolveEffectiveUnitPrice(10000, undefined);
    assert.equal(result.unitPriceCents, 10000);
    assert.equal(result.originalPriceCents, undefined);
    assert.equal(result.discountPercent, undefined);
    assert.equal(result.couponBadge, undefined);
  });

  it("inline_percent: 20% off 10000 -> 8000, discountPercent 20, keeps original", () => {
    const promo: ActivePromotion = { kind: "inline_percent", percent: 20 };
    const result = resolveEffectiveUnitPrice(10000, promo);
    assert.equal(result.unitPriceCents, 8000);
    assert.equal(result.originalPriceCents, 10000);
    assert.equal(result.discountPercent, 20);
  });

  it("inline_percent: clamps resulting price >= 0 (percent >= 100)", () => {
    const promo: ActivePromotion = { kind: "inline_percent", percent: 100 };
    const result = resolveEffectiveUnitPrice(10000, promo);
    assert.equal(result.unitPriceCents, 0);
    assert.equal(result.originalPriceCents, 10000);
    assert.equal(result.discountPercent, 100);
    // Over-100 (defensive): price never goes negative.
    const over = resolveEffectiveUnitPrice(10000, { kind: "inline_percent", percent: 150 });
    assert.equal(over.unitPriceCents, 0);
  });

  it("inline_fixed: 10000 - 3000 -> 7000, discountPercent 30", () => {
    const promo: ActivePromotion = { kind: "inline_fixed", amountCents: 3000 };
    const result = resolveEffectiveUnitPrice(10000, promo);
    assert.equal(result.unitPriceCents, 7000);
    assert.equal(result.originalPriceCents, 10000);
    assert.equal(result.discountPercent, 30);
  });

  it("inline_fixed: amount larger than base clamps to 0", () => {
    const promo: ActivePromotion = { kind: "inline_fixed", amountCents: 15000 };
    const result = resolveEffectiveUnitPrice(10000, promo);
    assert.equal(result.unitPriceCents, 0);
    assert.equal(result.originalPriceCents, 10000);
    assert.equal(result.discountPercent, 100);
  });

  it("inline_price: promo 6000 on 10000 base -> 6000, discountPercent 40", () => {
    const promo: ActivePromotion = { kind: "inline_price", promoPriceCents: 6000 };
    const result = resolveEffectiveUnitPrice(10000, promo);
    assert.equal(result.unitPriceCents, 6000);
    assert.equal(result.originalPriceCents, 10000);
    assert.equal(result.discountPercent, 40);
  });

  it("inline_price: negative promo price clamps to 0", () => {
    const promo: ActivePromotion = { kind: "inline_price", promoPriceCents: -500 };
    const result = resolveEffectiveUnitPrice(10000, promo);
    assert.equal(result.unitPriceCents, 0);
    assert.equal(result.discountPercent, 100);
  });

  it("INVARIANT: coupon promo must NOT reduce unitPriceCents; only attaches a badge", () => {
    // No fabricated discount: the product coupon flag alone grants nothing.
    // Coupon effect happens at cart via ApplyCoupon, capped by rules-engine.
    const promo: ActivePromotion = { kind: "coupon", couponId: "cpn_123" };
    const result = resolveEffectiveUnitPrice(10000, promo);
    assert.equal(result.unitPriceCents, 10000); // base unchanged
    assert.deepEqual(result.couponBadge, { couponId: "cpn_123" });
    assert.equal(result.discountPercent, undefined);
    assert.equal(result.originalPriceCents, undefined);
  });
});
