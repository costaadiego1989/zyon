import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { Cart } from "@zyon/shared-types";
import { CrossSellPromotionEntity } from "../entities/cross-sell-promotion.entity.js";
import { rankEligiblePromotions } from "./cross-sell-recommender.service.js";

function makePromo(overrides: {
  trigger?: { sku_in_cart?: string[]; category_in_cart?: string[]; cart_total_above?: number };
  recommended_skus?: string[];
  discount_percent?: number;
  starts_at?: Date;
  ends_at?: Date;
  status?: "active" | "archived";
} = {}) {
  const promo = CrossSellPromotionEntity.create({
    merchant_id: "mrc_1",
    name: "Promo",
    trigger: overrides.trigger ?? { sku_in_cart: ["SKU-X"] },
    recommended_skus: overrides.recommended_skus ?? ["SKU-Y"],
    discount_percent: overrides.discount_percent ?? 10,
    max_discount_percent: 30,
    starts_at: overrides.starts_at ?? new Date(Date.now() - 1000),
    ends_at: overrides.ends_at,
  });
  return overrides.status === "archived" ? promo.archive() : promo;
}

function makeCart(overrides: Partial<Cart> = {}): Cart {
  return {
    currency: "BRL",
    items: [{ sku: "SKU-X", price: 100, quantity: 1, name: "X" }],
    total: 100,
    ...overrides,
  };
}

describe("rankEligiblePromotions", () => {
  it("returns empty list when no promotions provided", () => {
    assert.deepEqual(rankEligiblePromotions([], makeCart()), []);
  });

  it("filters out ineligible promotions (e.g., archived)", () => {
    const eligible = makePromo({ discount_percent: 5 });
    const archived = makePromo({ status: "archived", discount_percent: 50 });
    const result = rankEligiblePromotions([eligible, archived], makeCart());
    assert.equal(result.length, 1);
    assert.equal(result[0].promo_id, eligible.id);
  });

  it("ranks results by discount_percent descending", () => {
    const low = makePromo({ discount_percent: 5 });
    const high = makePromo({ discount_percent: 25 });
    const mid = makePromo({ discount_percent: 15 });
    const result = rankEligiblePromotions([low, high, mid], makeCart());
    assert.deepEqual(
      result.map((r) => r.discount_percent),
      [25, 15, 5],
    );
  });

  it("excludes skus already in cart from ranked_items", () => {
    const promo = makePromo({ recommended_skus: ["SKU-A", "SKU-X", "SKU-B"] });
    const cart = makeCart({ items: [{ sku: "SKU-X", price: 100, quantity: 1, name: "X" }], total: 100 });
    const result = rankEligiblePromotions([promo], cart);
    assert.equal(result.length, 1);
    assert.deepEqual(result[0].ranked_items, ["SKU-A", "SKU-B"]);
  });

  it("drops promotion when all recommended skus are already in cart", () => {
    const promo = makePromo({ recommended_skus: ["SKU-X"] });
    const result = rankEligiblePromotions([promo], makeCart());
    assert.equal(result.length, 0);
  });

  it("emits each promo with the correct discount_percent and id", () => {
    const promo = makePromo({ discount_percent: 12, recommended_skus: ["SKU-A"] });
    const result = rankEligiblePromotions([promo], makeCart());
    assert.equal(result[0].promo_id, promo.id);
    assert.equal(result[0].discount_percent, 12);
    assert.deepEqual(result[0].ranked_items, ["SKU-A"]);
  });

  it("respects sku_in_cart trigger eligibility", () => {
    const match = makePromo({ trigger: { sku_in_cart: ["SKU-X"] }, discount_percent: 10 });
    const miss = makePromo({ trigger: { sku_in_cart: ["SKU-OTHER"] }, discount_percent: 20 });
    const result = rankEligiblePromotions([match, miss], makeCart());
    assert.equal(result.length, 1);
    assert.equal(result[0].promo_id, match.id);
  });

  it("respects cart_total_above trigger", () => {
    const big = makePromo({ trigger: { cart_total_above: 200 }, discount_percent: 30 });
    const small = makePromo({ trigger: { cart_total_above: 50 }, discount_percent: 5 });
    const cart = makeCart({ total: 150 });
    const result = rankEligiblePromotions([big, small], cart);
    assert.equal(result.length, 1);
    assert.equal(result[0].promo_id, small.id);
  });
});