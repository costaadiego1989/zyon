import test from "node:test";
import assert from "node:assert/strict";
import { PrismaCrossSellSuggestionRepository } from "./prisma-cross-sell-suggestion.repository.js";
import { CrossSellSuggestionEntity } from "../../domain/entities/cross-sell-suggestion.entity.js";
import { CrossSellPromotionEntity } from "../../domain/entities/cross-sell-promotion.entity.js";
import { InMemoryCrossSellPromotionRepository } from "./in-memory-cross-sell-promotion.repository.js";
import { InMemoryOutboxRepository } from "../../../../shared/messaging/infrastructure/in-memory-outbox.repository.js";
import { ListEligibleCrossSellsUseCase } from "../../application/use-cases/list-eligible-cross-sells.use-case.js";

for (const raced of [false, true]) test(`Prisma pending refresh ${raced ? "preserves concurrent acceptance" : "persists the current targets"} without lifecycle writes`, async () => {
  const promotion = CrossSellPromotionEntity.create({ merchant_id: "merchant", name: "Complemento", trigger: { sku_in_cart: ["CABLE"] },
    recommended_skus: ["CASE"], discount_percent: 0, max_discount_percent: 0, starts_at: new Date(0) });
  const promotions = new InMemoryCrossSellPromotionRepository(); await promotions.save(promotion);
  const snapshot = CrossSellSuggestionEntity.create({ merchant_id: "merchant", session_id: "session", promo_id: promotion.id,
    ranked_items: ["OLD"], computed_discount: 10, agent_copy: "" }).snapshot();
  let row: any = { id: snapshot.id, merchantId: "merchant", sessionId: "session", promoId: promotion.id, rankedItems: ["OLD"], computedDiscount: 10,
    agentCopy: "", status: "pending", suggestedAt: new Date(), resolvedAt: null };
  const writes: any[] = [];
  const repository = new PrismaCrossSellSuggestionRepository({ crossSellSuggestion: {
    findMany: async () => [{ ...row }],
    updateMany: async (args: any) => { writes.push(args); if (raced) row = { ...row, status: "accepted", resolvedAt: new Date() };
      const match = Object.entries(args.where).every(([key, value]) => row[key] === value);
      if (match) row = { ...row, ...args.data }; return { count: match ? 1 : 0 }; },
    upsert: async () => assert.fail("refresh must not use lifecycle upsert"),
  } } as never);
  const useCase = new ListEligibleCrossSellsUseCase(promotions, repository, new InMemoryOutboxRepository());
  const result = await useCase.execute({ merchant_id: "merchant", session_id: "session", cart: { currency: "BRL", total: 10,
    items: [{ sku: "CABLE", name: "Cabo", price: 10, quantity: 1 }] }, enabled_strategies: ["complementary"] });
  assert.equal(writes.length, 1);
  assert.deepEqual(writes[0], { where: { id: snapshot.id, merchantId: "merchant", sessionId: "session", status: "pending" },
    data: { rankedItems: ["CASE"], computedDiscount: 0 } });
  if (raced) { assert.deepEqual(result, []); assert.equal(row.status, "accepted"); assert.ok(row.resolvedAt); }
  else { assert.deepEqual(result[0]?.ranked_items, ["CASE"]); assert.deepEqual(row.rankedItems, ["CASE"]); assert.equal(row.computedDiscount, 0); }
});
