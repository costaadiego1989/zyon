import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { CheckoutCrossSellRecommender } from "./checkout-cross-sell-recommender.js";
import { ListEligibleCrossSellsUseCase } from "../use-cases/list-eligible-cross-sells.use-case.js";
import { CrossSellPromotionEntity } from "../../domain/entities/cross-sell-promotion.entity.js";
import { InMemoryCrossSellPromotionRepository } from "../../infrastructure/repositories/in-memory-cross-sell-promotion.repository.js";
import { InMemoryCrossSellSuggestionRepository } from "../../infrastructure/repositories/in-memory-cross-sell-suggestion.repository.js";
import { InMemoryOutboxRepository } from "../../../../shared/messaging/infrastructure/in-memory-outbox.repository.js";

function setup() {
  const promotions = new InMemoryCrossSellPromotionRepository();
  const suggestions = new InMemoryCrossSellSuggestionRepository();
  const outbox = new InMemoryOutboxRepository();
  const listEligible = new ListEligibleCrossSellsUseCase(promotions, suggestions, outbox);
  // Mock merchant with crossSell enabled so the recommender proceeds past the enabled check
  const prismaMock = {
    merchant: { findUnique: async () => ({ storeSettings: { crossSell: { enabled: true } } }) },
    crossSellSuggestion: { findFirst: async () => null },
  } as any;
  const recommender = new CheckoutCrossSellRecommender(listEligible, prismaMock);
  return { promotions, suggestions, outbox, recommender };
}

describe("CheckoutCrossSellRecommender", () => {
  it("returns suggested product metadata when an active promotion matches checkout cart", async () => {
    const { promotions, recommender } = setup();
    await promotions.save(CrossSellPromotionEntity.create({
      merchant_id: "mrc_zyon",
      name: "Zyon hoodie combo",
      trigger: { sku_in_cart: ["ZYON-SHIRT-001"] },
      recommended_skus: ["ZYON-HOOD-001"],
      discount_percent: 15,
      max_discount_percent: 15,
      starts_at: new Date(Date.now() - 60_000)
    }));

    const products = await recommender.suggest({
      merchant_id: "mrc_zyon",
      session_id: "chk_zyon",
      cart: {
        currency: "BRL",
        total: 129.9,
        items: [{ sku: "ZYON-SHIRT-001", name: "Camiseta Zyon Dev", price: 129.9, quantity: 1 }]
      }
    });

    assert.equal(products.length, 1);
    assert.equal(products[0]?.sku, "ZYON-HOOD-001");
    assert.equal(products[0]?.name, "Hoodie Agentic Checkout");
    assert.equal(products[0]?.unit_price, 199.9);
    assert.ok(products[0]?.suggestion_id);
  });

  it("returns no suggestions when the cart does not match any promotion", async () => {
    const { promotions, recommender } = setup();
    await promotions.save(CrossSellPromotionEntity.create({
      merchant_id: "mrc_zyon",
      name: "Zyon hoodie combo",
      trigger: { sku_in_cart: ["ZYON-SHIRT-001"] },
      recommended_skus: ["ZYON-HOOD-001"],
      discount_percent: 15,
      max_discount_percent: 15,
      starts_at: new Date(Date.now() - 60_000)
    }));

    const products = await recommender.suggest({
      merchant_id: "mrc_zyon",
      session_id: "chk_nomatch",
      cart: {
        currency: "BRL",
        total: 129.9,
        items: [{ sku: "OTHER-SKU", name: "Other", price: 129.9, quantity: 1 }]
      }
    });

    assert.deepEqual(products, []);
  });
});
