import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { AcceptCrossSellSuggestionUseCase } from "./accept-cross-sell-suggestion.use-case.js";
import { ListEligibleCrossSellsUseCase } from "./list-eligible-cross-sells.use-case.js";
import { CrossSellPromotionEntity } from "../../domain/entities/cross-sell-promotion.entity.js";
import { CrossSellSuggestionEntity } from "../../domain/entities/cross-sell-suggestion.entity.js";
import { InMemoryCrossSellPromotionRepository } from "../../infrastructure/repositories/in-memory-cross-sell-promotion.repository.js";
import { InMemoryCrossSellSuggestionRepository } from "../../infrastructure/repositories/in-memory-cross-sell-suggestion.repository.js";
import { InMemoryOutboxRepository } from "../../../../shared/messaging/infrastructure/in-memory-outbox.repository.js";
import type { Cart, MerchantRules } from "@zyon/shared-types";
import { DEFAULT_MERCHANT_RULES } from "@zyon/shared-types";

const PERMISSIVE_RULES: MerchantRules = {
  ...DEFAULT_MERCHANT_RULES,
  maxDiscountPercent: 100,
  minimumMarginPercent: 0,
  couponBoxEnabled: true,
};

const BASE_CART: Cart = {
  items: [{ sku: "SKU-X", price: 100, quantity: 1, name: "X" }],
  total: 100,
  currency: "BRL",
};

function makePromo(merchantId = "mrc_1") {
  return CrossSellPromotionEntity.create({
    merchant_id: merchantId,
    name: "Test Promo",
    trigger: { sku_in_cart: ["SKU-X"] },
    recommended_skus: ["SKU-Y", "SKU-Z"],
    discount_percent: 10,
    max_discount_percent: 20,
    starts_at: new Date(Date.now() - 1000),
  });
}

function makeSuggestionSetup() {
  const promoRepo = new InMemoryCrossSellPromotionRepository();
  const suggestionRepo = new InMemoryCrossSellSuggestionRepository();
  const outbox = new InMemoryOutboxRepository();
  const prismaStub = { checkoutEvent: { findFirst: async () => null, create: async () => ({}) } } as never;
  const acceptUseCase = new AcceptCrossSellSuggestionUseCase(suggestionRepo, promoRepo, outbox, prismaStub);
  const listUseCase = new ListEligibleCrossSellsUseCase(promoRepo, suggestionRepo, outbox);
  return { promoRepo, suggestionRepo, outbox, acceptUseCase, listUseCase };
}

describe("AcceptCrossSellSuggestionUseCase", () => {
  it("accepts suggestion with valid skus", async () => {
    const { promoRepo, suggestionRepo, outbox, acceptUseCase } = makeSuggestionSetup();
    const promo = makePromo();
    await promoRepo.save(promo);

    const suggestion = CrossSellSuggestionEntity.create({
      session_id: "sess_1",
      merchant_id: "mrc_1",
      promo_id: promo.id,
      ranked_items: ["SKU-Y", "SKU-Z"],
      agent_copy: "",
      computed_discount: 10,
    });
    await suggestionRepo.save(suggestion);

    const snap = await acceptUseCase.execute({
      suggestion_id: suggestion.id,
      merchant_id: "mrc_1",
      session_id: "sess_1",
      accepted_skus: ["SKU-Y"],
      cart: BASE_CART,
      merchantRules: PERMISSIVE_RULES,
    });

    assert.equal(snap.status, "accepted");
    const events = outbox.listOutbox("mrc_1");
    assert.equal(events[0].event_type, "cross-sell.offer.accepted");
  });

  // ── P1 regression: accepted_skus must be subset of ranked_items ──────────

  it("P1: rejects accepted_skus that are not in suggestion's ranked_items", async () => {
    const { promoRepo, suggestionRepo, acceptUseCase } = makeSuggestionSetup();
    const promo = makePromo();
    await promoRepo.save(promo);

    const suggestion = CrossSellSuggestionEntity.create({
      session_id: "sess_1",
      merchant_id: "mrc_1",
      promo_id: promo.id,
      ranked_items: ["SKU-Y"],
      agent_copy: "",
      computed_discount: 10,
    });
    await suggestionRepo.save(suggestion);

    await assert.rejects(
      () => acceptUseCase.execute({
        suggestion_id: suggestion.id,
        merchant_id: "mrc_1",
        session_id: "sess_1",
        accepted_skus: ["SKU-ATTACKER"], // not in ranked_items
      }),
      (err: { message?: string }) => {
        assert.ok(err.message?.startsWith("INVALID_ACCEPTED_SKUS"), `unexpected: ${err.message}`);
        return true;
      }
    );
  });

  // ── P0 regression: discount must pass through rules-engine ───────────────

  it("P0: rejects accept when discount exceeds promotion max_discount_percent cap", async () => {
    const { promoRepo, suggestionRepo, acceptUseCase } = makeSuggestionSetup();
    const promo = makePromo(); // max_discount_percent = 20
    await promoRepo.save(promo);

    // Suggestion with computed_discount exceeding max_discount_percent
    const suggestion = CrossSellSuggestionEntity.create({
      session_id: "sess_1",
      merchant_id: "mrc_1",
      promo_id: promo.id,
      ranked_items: ["SKU-Y"],
      agent_copy: "",
      computed_discount: 50, // exceeds max_discount_percent=20
    });
    await suggestionRepo.save(suggestion);

    await assert.rejects(
      () => acceptUseCase.execute({
        suggestion_id: suggestion.id,
        merchant_id: "mrc_1",
        session_id: "sess_1",
        accepted_skus: ["SKU-Y"],
        // No merchantRules → falls back to promotion cap
      }),
      (err: { message?: string }) => {
        assert.ok(
          err.message?.startsWith("CROSS_SELL_DISCOUNT_EXCEEDS_CAP"),
          `unexpected: ${err.message}`
        );
        return true;
      }
    );
  });

  // ── P0 stacking regression: aggregate discount capped ───────────────────

  it("P0: rejects accept when stacked discounts exceed maxDiscountPercent", async () => {
    const { promoRepo, suggestionRepo, acceptUseCase } = makeSuggestionSetup();
    const promo = makePromo(); // max_discount_percent = 20
    await promoRepo.save(promo);

    const suggestion = CrossSellSuggestionEntity.create({
      session_id: "sess_1",
      merchant_id: "mrc_1",
      promo_id: promo.id,
      ranked_items: ["SKU-Y"],
      agent_copy: "",
      computed_discount: 10,
    });
    await suggestionRepo.save(suggestion);

    const tightRules: MerchantRules = { ...PERMISSIVE_RULES, maxDiscountPercent: 15 };

    await assert.rejects(
      () => acceptUseCase.execute({
        suggestion_id: suggestion.id,
        merchant_id: "mrc_1",
        session_id: "sess_1",
        accepted_skus: ["SKU-Y"],
        cart: BASE_CART,
        merchantRules: tightRules,
        currentCouponDiscountPercent: 8, // 10 + 8 = 18 > 15
      }),
      (err: { message?: string }) => {
        assert.ok(err.message?.startsWith("DISCOUNT_CAP_EXCEEDED"), `unexpected: ${err.message}`);
        return true;
      }
    );
  });
});

describe("ListEligibleCrossSellsUseCase", () => {
  // ── P2 regression: no duplicate suggestions ──────────────────────────────

  it("P2: does not create duplicate pending suggestion on repeated calls", async () => {
    const { promoRepo, suggestionRepo, outbox, listUseCase } = makeSuggestionSetup();
    await promoRepo.save(makePromo());

    await listUseCase.execute({ session_id: "sess_1", merchant_id: "mrc_1", cart: BASE_CART });
    await listUseCase.execute({ session_id: "sess_1", merchant_id: "mrc_1", cart: BASE_CART });

    // Only one outbox event should have been emitted
    const events = outbox.listOutbox("mrc_1").filter((e) => e.event_type === "cross-sell.offer.suggested");
    assert.equal(events.length, 1, "should not emit duplicate suggestion events");

    // Only one pending suggestion in store
    const stored = await suggestionRepo.findBySession("sess_1", "mrc_1");
    assert.equal(stored.filter((s) => s.snapshot().status === "pending").length, 1);
  });
});
