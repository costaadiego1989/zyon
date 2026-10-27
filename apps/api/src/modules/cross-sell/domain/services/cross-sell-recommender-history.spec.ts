import test from "node:test";
import assert from "node:assert/strict";
import { rankEligiblePromotions } from "./cross-sell-recommender.service.js";
import { CrossSellPromotionEntity } from "../entities/cross-sell-promotion.entity.js";
import type { Cart } from "@zyon/shared-types";

const CART: Cart = {
  currency: "BRL", source: "storefront", total: 100,
  items: [{ sku: "in-cart-1", name: "X", price: 100, quantity: 1, category: "Apparel" }]
};

function makePromo(args: {
  id: string;
  discount: number;
  triggerCategory?: string[];
  recommended?: string[];
}) {
  return CrossSellPromotionEntity.create({
    merchant_id: "mrc",
    name: args.id,
    trigger: args.triggerCategory ? { category_in_cart: args.triggerCategory } : { sku_in_cart: [] },
    recommended_skus: args.recommended ?? [`sku-${args.id}`],
    discount_percent: args.discount,
    max_discount_percent: args.discount,
    starts_at: new Date()
  });
}

test("rankEligiblePromotions: history boost — top_categories overlap lifts promotion", () => {
  const a = makePromo({ id: "A", discount: 5, triggerCategory: ["Apparel"] });
  const b = makePromo({ id: "B", discount: 5, triggerCategory: ["Books"] });
  const ranked = rankEligiblePromotions([b, a], CART, { top_categories: ["Apparel"], recent_skus: [] });
  // Same discount, but A matches buyer's top category — should rank first.
  assert.equal(ranked[0]!.promo_id, a.snapshot().id, "category-matching promo wins tie");
});

test("rankEligiblePromotions: history boost — recent_skus overlap wins over category", () => {
  const a = makePromo({ id: "A", discount: 5, triggerCategory: ["Apparel"] });
  const b = makePromo({ id: "B", discount: 5, recommended: ["sock-002"] });
  const ranked = rankEligiblePromotions([a, b], CART, { top_categories: ["Apparel"], recent_skus: ["sock-002"] });
  // B has sku match (boost=2) vs A has category match (boost=1) — B should win.
  assert.equal(ranked[0]!.promo_id, b.snapshot().id, "sku match outweighs category match");
});

test("rankEligiblePromotions: no history bias → discount-only ranking preserved", () => {
  const a = makePromo({ id: "A", discount: 5 });
  const b = makePromo({ id: "B", discount: 10 });
  const ranked = rankEligiblePromotions([a, b], CART);
  assert.equal(ranked[0]!.promo_id, b.snapshot().id, "higher discount wins when no history");
});

test("rankEligiblePromotions: empty history arrays → no boost", () => {
  const a = makePromo({ id: "A", discount: 5 });
  const b = makePromo({ id: "B", discount: 10 });
  const ranked = rankEligiblePromotions([a, b], CART, { top_categories: [], recent_skus: [] });
  assert.equal(ranked[0]!.promo_id, b.snapshot().id, "empty history still ranks by discount");
});