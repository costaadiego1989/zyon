import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { CrossSellPromotionEntity } from "./cross-sell-promotion.entity.js";
import { CrossSellSuggestionEntity } from "./cross-sell-suggestion.entity.js";

describe("CrossSellPromotionEntity", () => {
  const baseInput = {
    merchant_id: "mrc_1",
    name: "Promo",
    trigger: { sku_in_cart: ["SKU-X"] },
    recommended_skus: ["SKU-Y"],
    discount_percent: 10,
    max_discount_percent: 20,
    starts_at: new Date(Date.now() - 1000),
  };

  it("creates an active promotion with expected snapshot fields", () => {
    const promo = CrossSellPromotionEntity.create(baseInput);
    const snap = promo.snapshot();
    assert.equal(snap.status, "active");
    assert.equal(snap.merchant_id, "mrc_1");
    assert.equal(snap.name, "Promo");
    assert.equal(snap.discount_percent, 10);
    assert.equal(snap.max_discount_percent, 20);
    assert.equal(snap.recommended_skus.length, 1);
    assert.equal(snap.ends_at, null);
    assert.equal(typeof snap.id, "string");
    assert.ok(snap.created_at);
    assert.ok(snap.updated_at);
    assert.equal(promo.id, snap.id);
    assert.equal(promo.merchant_id, "mrc_1");
    assert.equal(promo.isActive(), true);
  });

  it("trims merchant_id and name on create", () => {
    const promo = CrossSellPromotionEntity.create({ ...baseInput, merchant_id: "  mrc_2  ", name: "  Trimmed  " });
    const snap = promo.snapshot();
    assert.equal(snap.merchant_id, "mrc_2");
    assert.equal(snap.name, "Trimmed");
  });

  it("persists ends_at when provided", () => {
    const endsAt = new Date(Date.now() + 86_400_000);
    const promo = CrossSellPromotionEntity.create({ ...baseInput, ends_at: endsAt });
    assert.equal(promo.snapshot().ends_at, endsAt.toISOString());
  });

  it("rejects empty merchant_id", () => {
    assert.throws(() => CrossSellPromotionEntity.create({ ...baseInput, merchant_id: "   " }), /merchant_required/);
  });

  it("rejects empty name", () => {
    assert.throws(() => CrossSellPromotionEntity.create({ ...baseInput, name: "  " }), /name_required/);
  });

  it("rejects empty recommended_skus", () => {
    assert.throws(() => CrossSellPromotionEntity.create({ ...baseInput, recommended_skus: [] }), /skus_required/);
  });

  it("rejects discount below 0", () => {
    assert.throws(() => CrossSellPromotionEntity.create({ ...baseInput, discount_percent: -1 }), /discount_invalid/);
  });

  it("rejects discount above 100", () => {
    assert.throws(() => CrossSellPromotionEntity.create({ ...baseInput, discount_percent: 101 }), /discount_invalid/);
  });

  it("accepts discount at boundaries 0 and 100", () => {
    const a = CrossSellPromotionEntity.create({ ...baseInput, discount_percent: 0 });
    const b = CrossSellPromotionEntity.create({ ...baseInput, discount_percent: 100 });
    assert.equal(a.snapshot().discount_percent, 0);
    assert.equal(b.snapshot().discount_percent, 100);
  });

  it("archive() returns a new entity with status=archived and refreshed updated_at", async () => {
    const promo = CrossSellPromotionEntity.create(baseInput);
    const before = promo.snapshot().updated_at;
    await new Promise((r) => setTimeout(r, 5));
    const archived = promo.archive();
    assert.equal(archived.snapshot().status, "archived");
    assert.equal(archived.isActive(), false);
    assert.notEqual(archived.snapshot().updated_at, before);
    // immutability: original unaffected
    assert.equal(promo.isActive(), true);
  });

  it("update() merges patch and refreshes updated_at", async () => {
    const promo = CrossSellPromotionEntity.create(baseInput);
    const before = promo.snapshot().updated_at;
    await new Promise((r) => setTimeout(r, 5));
    const updated = promo.update({ name: "New", discount_percent: 15, recommended_skus: ["SKU-A", "SKU-B"] });
    const snap = updated.snapshot();
    assert.equal(snap.name, "New");
    assert.equal(snap.discount_percent, 15);
    assert.deepEqual(snap.recommended_skus, ["SKU-A", "SKU-B"]);
    assert.notEqual(snap.updated_at, before);
    // original unchanged
    assert.equal(promo.snapshot().name, "Promo");
  });

  it("rehydrate() preserves the snapshot", () => {
    const promo = CrossSellPromotionEntity.create(baseInput);
    const snap = promo.snapshot();
    const rehydrated = CrossSellPromotionEntity.rehydrate(snap);
    assert.deepEqual(rehydrated.snapshot(), snap);
  });
});

describe("CrossSellSuggestionEntity", () => {
  const baseInput = {
    session_id: "sess_1",
    merchant_id: "mrc_1",
    promo_id: "promo_1",
    ranked_items: ["SKU-Y", "SKU-Z"],
    agent_copy: "Add a wallet?",
    computed_discount: 10,
  };

  it("creates a pending suggestion with expected snapshot fields", () => {
    const suggestion = CrossSellSuggestionEntity.create(baseInput);
    const snap = suggestion.snapshot();
    assert.equal(snap.status, "pending");
    assert.equal(snap.session_id, "sess_1");
    assert.equal(snap.merchant_id, "mrc_1");
    assert.equal(snap.promo_id, "promo_1");
    assert.deepEqual(snap.ranked_items, ["SKU-Y", "SKU-Z"]);
    assert.equal(snap.agent_copy, "Add a wallet?");
    assert.equal(snap.computed_discount, 10);
    assert.ok(snap.suggested_at);
    assert.equal(snap.resolved_at, null);
    assert.equal(suggestion.id, snap.id);
    assert.equal(suggestion.merchant_id, "mrc_1");
  });

  it("accept() transitions to accepted with filtered ranked_items and resolved_at", async () => {
    const suggestion = CrossSellSuggestionEntity.create(baseInput);
    await new Promise((r) => setTimeout(r, 5));
    const accepted = suggestion.accept(["SKU-Y"]);
    const snap = accepted.snapshot();
    assert.equal(snap.status, "accepted");
    assert.deepEqual(snap.ranked_items, ["SKU-Y"]);
    assert.ok(snap.resolved_at);
    // immutability
    assert.equal(suggestion.snapshot().status, "pending");
  });

  it("accept() with empty list returns accepted with empty ranked_items", () => {
    const suggestion = CrossSellSuggestionEntity.create(baseInput);
    const accepted = suggestion.accept([]);
    assert.equal(accepted.snapshot().status, "accepted");
    assert.deepEqual(accepted.snapshot().ranked_items, []);
  });

  it("accept() rejects skus not present in ranked_items", () => {
    const suggestion = CrossSellSuggestionEntity.create(baseInput);
    assert.throws(
      () => suggestion.accept(["SKU-NOPE"]),
      /accepted_skus_not_in_suggestion:SKU-NOPE/,
    );
  });

  it("accept() rejects when status is not pending", () => {
    const suggestion = CrossSellSuggestionEntity.create(baseInput);
    const accepted = suggestion.accept(["SKU-Y"]);
    assert.throws(() => accepted.accept(["SKU-Z"]), /illegal_transition/);
  });

  it("decline() transitions to declined with resolved_at", async () => {
    const suggestion = CrossSellSuggestionEntity.create(baseInput);
    await new Promise((r) => setTimeout(r, 5));
    const declined = suggestion.decline();
    const snap = declined.snapshot();
    assert.equal(snap.status, "declined");
    assert.ok(snap.resolved_at);
    // ranked_items preserved on decline
    assert.deepEqual(snap.ranked_items, ["SKU-Y", "SKU-Z"]);
    // immutability
    assert.equal(suggestion.snapshot().status, "pending");
  });

  it("decline() rejects when status is not pending", () => {
    const suggestion = CrossSellSuggestionEntity.create(baseInput);
    const declined = suggestion.decline();
    assert.throws(() => declined.decline(), /illegal_transition/);
  });

  it("rehydrate() preserves the snapshot", () => {
    const suggestion = CrossSellSuggestionEntity.create(baseInput);
    const snap = suggestion.snapshot();
    const rehydrated = CrossSellSuggestionEntity.rehydrate(snap);
    assert.deepEqual(rehydrated.snapshot(), snap);
  });
});