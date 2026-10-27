import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isPromotionEligible } from "./eligibility.policy.js";
import { evaluateStacking } from "./stacking.policy.js";
import { CrossSellPromotionEntity } from "../entities/cross-sell-promotion.entity.js";
import type { Cart } from "@zyon/shared-types";

function makePromotion(overrides: {
  trigger?: Parameters<typeof CrossSellPromotionEntity.create>[0]["trigger"];
  recommended_skus?: string[];
  starts_at?: Date;
  ends_at?: Date;
  status?: "active" | "archived";
} = {}) {
  const promo = CrossSellPromotionEntity.create({
    merchant_id: "mrc_1",
    name: "Test Promo",
    recommended_skus: overrides.recommended_skus ?? ["SKU-Y"],
    discount_percent: 10,
    max_discount_percent: 20,
    trigger: overrides.trigger ?? { sku_in_cart: ["SKU-X"] },
    starts_at: overrides.starts_at ?? new Date(Date.now() - 1000),
    ends_at: overrides.ends_at,
  });
  if (overrides.status === "archived") return promo.archive();
  return promo;
}

function makeCart(overrides: Partial<Cart> = {}): Cart {
  return {
    items: [{ sku: "SKU-X", price: 100, quantity: 1, name: "Item X" }],
    total: 100,
    currency: "BRL",
    ...overrides,
  };
}

describe("eligibility.policy", () => {
  it("allows eligible promotion matching SKU trigger", () => {
    assert.equal(isPromotionEligible(makePromotion(), makeCart()), true);
  });

  it("rejects archived promotion", () => {
    assert.equal(isPromotionEligible(makePromotion({ status: "archived" }), makeCart()), false);
  });

  it("rejects promotion not yet started", () => {
    const promo = makePromotion({ starts_at: new Date(Date.now() + 3_600_000) });
    assert.equal(isPromotionEligible(promo, makeCart()), false);
  });

  it("rejects promotion past ends_at", () => {
    const promo = makePromotion({ ends_at: new Date(Date.now() - 1000) });
    assert.equal(isPromotionEligible(promo, makeCart()), false);
  });

  it("rejects when SKU trigger not in cart", () => {
    const cart = makeCart({ items: [{ sku: "OTHER", price: 50, quantity: 1, name: "Other" }], total: 50 });
    assert.equal(isPromotionEligible(makePromotion(), cart), false);
  });

  it("rejects when cart total below threshold", () => {
    const promo = makePromotion({ trigger: { cart_total_above: 200 } });
    assert.equal(isPromotionEligible(promo, makeCart({ total: 100 })), false);
  });

  it("rejects when all recommended skus already in cart", () => {
    const promo = makePromotion({ recommended_skus: ["SKU-X"] });
    assert.equal(isPromotionEligible(promo, makeCart()), false);
  });

  it("allows when category trigger matches", () => {
    const promo = makePromotion({ trigger: { category_in_cart: ["electronics"] }, recommended_skus: ["SKU-Z"] });
    const cart = makeCart({ items: [{ sku: "SOME", price: 50, quantity: 1, name: "Item", category: "electronics" }], total: 50 });
    assert.equal(isPromotionEligible(promo, cart), true);
  });
});

describe("stacking.policy", () => {
  it("allows when total below cap", () => {
    const result = evaluateStacking({ crossSellDiscountPercent: 5, couponDiscountPercent: 5, negotiationDiscountPercent: 5, maxDiscountPercent: 20 });
    assert.equal(result.allowed, true);
    if (result.allowed) assert.equal(result.totalDiscountPercent, 15);
  });

  it("allows when total equals cap exactly", () => {
    const result = evaluateStacking({ crossSellDiscountPercent: 10, couponDiscountPercent: 5, negotiationDiscountPercent: 5, maxDiscountPercent: 20 });
    assert.equal(result.allowed, true);
  });

  it("rejects when total exceeds cap", () => {
    const result = evaluateStacking({ crossSellDiscountPercent: 10, couponDiscountPercent: 10, negotiationDiscountPercent: 5, maxDiscountPercent: 20 });
    assert.equal(result.allowed, false);
    if (!result.allowed) {
      assert.equal(result.reason, "DISCOUNT_CAP_EXCEEDED");
      assert.equal(result.totalDiscountPercent, 25);
      assert.equal(result.capPercent, 20);
    }
  });
});
