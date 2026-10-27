import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { CreateCrossSellPromotionUseCase } from "./create-cross-sell-promotion.use-case.js";
import { UpdateCrossSellPromotionUseCase } from "./update-cross-sell-promotion.use-case.js";
import { ArchiveCrossSellPromotionUseCase } from "./archive-cross-sell-promotion.use-case.js";
import { DeclineCrossSellSuggestionUseCase } from "./decline-cross-sell-suggestion.use-case.js";
import { ListEligibleCrossSellsUseCase } from "./list-eligible-cross-sells.use-case.js";
import { CrossSellPromotionEntity } from "../../domain/entities/cross-sell-promotion.entity.js";
import { CrossSellSuggestionEntity } from "../../domain/entities/cross-sell-suggestion.entity.js";
import { InMemoryCrossSellPromotionRepository } from "../../infrastructure/repositories/in-memory-cross-sell-promotion.repository.js";
import { InMemoryCrossSellSuggestionRepository } from "../../infrastructure/repositories/in-memory-cross-sell-suggestion.repository.js";
import { InMemoryOutboxRepository } from "../../../../shared/messaging/infrastructure/in-memory-outbox.repository.js";
import type { Cart } from "@zyon/shared-types";

const BASE_CART: Cart = {
  currency: "BRL",
  items: [{ sku: "SKU-X", price: 100, quantity: 1, name: "X" }],
  total: 100,
};

function makePromoInput(overrides: {
  merchant_id?: string;
  name?: string;
  trigger?: { sku_in_cart?: string[]; category_in_cart?: string[]; cart_total_above?: number };
  recommended_skus?: string[];
  discount_percent?: number;
  max_discount_percent?: number;
  starts_at?: Date;
  ends_at?: Date;
} = {}) {
  return {
    merchant_id: "mrc_1",
    name: "Promo",
    trigger: { sku_in_cart: ["SKU-X"] },
    recommended_skus: ["SKU-Y"],
    discount_percent: 10,
    max_discount_percent: 20,
    starts_at: new Date(Date.now() - 1000),
    ...overrides,
  };
}

function setup() {
  const promoRepo = new InMemoryCrossSellPromotionRepository();
  const suggestionRepo = new InMemoryCrossSellSuggestionRepository();
  const outbox = new InMemoryOutboxRepository();
  return {
    promoRepo,
    suggestionRepo,
    outbox,
    create: new CreateCrossSellPromotionUseCase(promoRepo),
    update: new UpdateCrossSellPromotionUseCase(promoRepo),
    archive: new ArchiveCrossSellPromotionUseCase(promoRepo),
    decline: new DeclineCrossSellSuggestionUseCase(suggestionRepo, outbox),
    listEligible: new ListEligibleCrossSellsUseCase(promoRepo, suggestionRepo, outbox),
  };
}

describe("CreateCrossSellPromotionUseCase", () => {
  it("creates and persists a promotion", async () => {
    const { create, promoRepo } = setup();
    const snap = await create.execute(makePromoInput({ name: "Hello" }));
    assert.equal(snap.name, "Hello");
    assert.equal(snap.status, "active");
    const stored = await promoRepo.findById(snap.id, "mrc_1");
    assert.ok(stored);
    assert.equal(stored.snapshot().name, "Hello");
  });

  it("propagates validation errors for empty merchant_id", async () => {
    const { create } = setup();
    await assert.rejects(
      () => create.execute(makePromoInput({ merchant_id: "  " })),
      /merchant_required/,
    );
  });

  it("propagates validation errors for empty recommended_skus", async () => {
    const { create } = setup();
    await assert.rejects(
      () => create.execute(makePromoInput({ recommended_skus: [] })),
      /skus_required/,
    );
  });

  it("propagates validation errors for out-of-range discount_percent", async () => {
    const { create } = setup();
    await assert.rejects(
      () => create.execute(makePromoInput({ discount_percent: 150 })),
      /discount_invalid/,
    );
  });

  it("persists ends_at when provided", async () => {
    const { create, promoRepo } = setup();
    const endsAt = new Date(Date.now() + 60_000);
    const snap = await create.execute(makePromoInput({ ends_at: endsAt }));
    const stored = await promoRepo.findById(snap.id, "mrc_1");
    assert.equal(stored?.snapshot().ends_at, endsAt.toISOString());
  });
});

describe("UpdateCrossSellPromotionUseCase", () => {
  it("updates fields and refreshes updated_at", async () => {
    const { create, update, promoRepo } = setup();
    const snap = await create.execute(makePromoInput());
    const before = snap.updated_at;
    await new Promise((r) => setTimeout(r, 5));
    const updated = await update.execute({
      id: snap.id,
      merchant_id: "mrc_1",
      patch: { name: "Renamed", discount_percent: 15 },
    });
    assert.equal(updated.name, "Renamed");
    assert.equal(updated.discount_percent, 15);
    assert.notEqual(updated.updated_at, before);
    const stored = await promoRepo.findById(snap.id, "mrc_1");
    assert.equal(stored?.snapshot().name, "Renamed");
  });

  it("throws NotFoundException when promotion does not exist", async () => {
    const { update } = setup();
    await assert.rejects(
      () => update.execute({ id: "missing", merchant_id: "mrc_1", patch: { name: "X" } }),
      (err: { message?: string }) => err.message?.includes("cross_sell_promotion_not_found") ?? false,
    );
  });

  it("does not cross merchant boundary: cannot update another merchant's promotion", async () => {
    const { create, update } = setup();
    const snap = await create.execute(makePromoInput({ merchant_id: "mrc_A" }));
    await assert.rejects(
      () => update.execute({ id: snap.id, merchant_id: "mrc_B", patch: { name: "Hijack" } }),
      (err: { message?: string }) => err.message?.includes("cross_sell_promotion_not_found") ?? false,
    );
  });
});

describe("ArchiveCrossSellPromotionUseCase", () => {
  it("archives an existing promotion", async () => {
    const { create, archive, promoRepo } = setup();
    const snap = await create.execute(makePromoInput());
    const archived = await archive.execute({ id: snap.id, merchant_id: "mrc_1" });
    assert.equal(archived.status, "archived");
    const stored = await promoRepo.findById(snap.id, "mrc_1");
    assert.equal(stored?.isActive(), false);
  });

  it("throws NotFoundException for unknown id", async () => {
    const { archive } = setup();
    await assert.rejects(
      () => archive.execute({ id: "nope", merchant_id: "mrc_1" }),
      (err: { message?: string }) => err.message?.includes("cross_sell_promotion_not_found") ?? false,
    );
  });

  it("does not archive another merchant's promotion", async () => {
    const { create, archive } = setup();
    const snap = await create.execute(makePromoInput({ merchant_id: "mrc_A" }));
    await assert.rejects(
      () => archive.execute({ id: snap.id, merchant_id: "mrc_B" }),
      (err: { message?: string }) => err.message?.includes("cross_sell_promotion_not_found") ?? false,
    );
  });
});

describe("DeclineCrossSellSuggestionUseCase", () => {
  function makePendingSuggestion(merchantId = "mrc_1", sessionId = "sess_1") {
    return CrossSellSuggestionEntity.create({
      session_id: sessionId,
      merchant_id: merchantId,
      promo_id: "promo_1",
      ranked_items: ["SKU-Y"],
      agent_copy: "",
      computed_discount: 10,
    });
  }

  it("declines a pending suggestion and emits outbox event", async () => {
    const { suggestionRepo, outbox, decline } = setup();
    const suggestion = makePendingSuggestion();
    await suggestionRepo.save(suggestion);

    const snap = await decline.execute({
      suggestion_id: suggestion.id,
      merchant_id: "mrc_1",
      session_id: "sess_1",
    });
    assert.equal(snap.status, "declined");
    const events = outbox.listOutbox("mrc_1");
    assert.equal(events.length, 1);
    assert.equal(events[0].event_type, "cross-sell.offer.declined");
    assert.equal((events[0].payload as { session_id: string }).session_id, "sess_1");
  });

  it("throws NotFoundException when suggestion does not exist", async () => {
    const { decline } = setup();
    await assert.rejects(
      () => decline.execute({ suggestion_id: "missing", merchant_id: "mrc_1", session_id: "sess_1" }),
      (err: { message?: string }) => err.message?.includes("cross_sell_suggestion_not_found") ?? false,
    );
  });

  it("does not decline another merchant's suggestion", async () => {
    const { suggestionRepo, decline } = setup();
    const suggestion = makePendingSuggestion("mrc_A");
    await suggestionRepo.save(suggestion);
    await assert.rejects(
      () => decline.execute({ suggestion_id: suggestion.id, merchant_id: "mrc_B", session_id: "sess_1" }),
      (err: { message?: string }) => err.message?.includes("cross_sell_suggestion_not_found") ?? false,
    );
  });
});

describe("ListEligibleCrossSellsUseCase", () => {
  it("returns empty array and no outbox events when no promotions exist", async () => {
    const { listEligible, outbox } = setup();
    const result = await listEligible.execute({ session_id: "sess_1", merchant_id: "mrc_1", cart: BASE_CART });
    assert.deepEqual(result, []);
    assert.equal(outbox.listOutbox("mrc_1").length, 0);
  });

  it("creates suggestions for all eligible active promotions and emits suggested events", async () => {
    const { create, listEligible, outbox } = setup();
    const a = await create.execute(makePromoInput({ name: "A", recommended_skus: ["SKU-A"], discount_percent: 10 }));
    const b = await create.execute(makePromoInput({ name: "B", recommended_skus: ["SKU-B"], discount_percent: 20 }));

    const result = await listEligible.execute({ session_id: "sess_1", merchant_id: "mrc_1", cart: BASE_CART });
    assert.equal(result.length, 2);
    // ranked by discount_percent desc → B first
    assert.equal(result[0].promo_id, b.id);
    assert.equal(result[1].promo_id, a.id);
    const events = outbox.listOutbox("mrc_1");
    assert.equal(events.length, 2);
    assert.ok(events.every((e) => e.event_type === "cross-sell.offer.suggested"));
  });

  it("skips promotions whose recommended skus are already in cart", async () => {
    const { create, listEligible } = setup();
    await create.execute(makePromoInput({ recommended_skus: ["SKU-X"] }));
    const result = await listEligible.execute({ session_id: "sess_1", merchant_id: "mrc_1", cart: BASE_CART });
    assert.equal(result.length, 0);
  });

  it("does not suggest archived promotions", async () => {
    const { create, archive, listEligible, outbox } = setup();
    const snap = await create.execute(makePromoInput({ name: "WillArchive" }));
    await archive.execute({ id: snap.id, merchant_id: "mrc_1" });

    const result = await listEligible.execute({ session_id: "sess_1", merchant_id: "mrc_1", cart: BASE_CART });
    assert.equal(result.length, 0);
    assert.equal(outbox.listOutbox("mrc_1").length, 0);
  });

  it("propagates agent_copy into persisted suggestion and outbox payload", async () => {
    const { create, listEligible, outbox } = setup();
    await create.execute(makePromoInput({ recommended_skus: ["SKU-A"] }));

    const result = await listEligible.execute({
      session_id: "sess_1",
      merchant_id: "mrc_1",
      cart: BASE_CART,
      agent_copy: "How about a wallet?",
    });
    assert.equal(result[0].agent_copy, "How about a wallet?");
    const events = outbox.listOutbox("mrc_1");
    assert.equal((events[0].payload as { agent_copy: string }).agent_copy, "How about a wallet?");
  });

  it("isolates by merchant_id: another merchant's promotions are not surfaced", async () => {
    const { create, listEligible } = setup();
    await create.execute(makePromoInput({ merchant_id: "mrc_A" }));
    await create.execute(makePromoInput({ merchant_id: "mrc_B" }));

    const result = await listEligible.execute({ session_id: "sess_1", merchant_id: "mrc_A", cart: BASE_CART });
    assert.equal(result.length, 1);
    assert.equal(result[0].merchant_id, "mrc_A");
  });

  it("reuses existing pending suggestions on repeat calls without emitting duplicate events", async () => {
    const { create, listEligible, suggestionRepo, outbox } = setup();
    await create.execute(makePromoInput({ recommended_skus: ["SKU-A"] }));

    await listEligible.execute({ session_id: "sess_1", merchant_id: "mrc_1", cart: BASE_CART });
    await listEligible.execute({ session_id: "sess_1", merchant_id: "mrc_1", cart: BASE_CART });

    const stored = await suggestionRepo.findBySession("sess_1", "mrc_1");
    assert.equal(stored.filter((s) => s.snapshot().status === "pending").length, 1);
    const events = outbox.listOutbox("mrc_1").filter((e) => e.event_type === "cross-sell.offer.suggested");
    assert.equal(events.length, 1);
  });
});