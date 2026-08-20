import test from "node:test";
import assert from "node:assert/strict";
import { RecoveryStrategySelector, type StrategySelectionInput } from "../domain/services/recovery-strategy-selector.service.js";

function input(overrides: Partial<{
  reason: StrategySelectionInput["abandonmentReason"];
  allowFreeShipping: boolean;
  maxDiscountPercent: number;
  discount_sensitivity: "high" | "medium" | "low";
  known_buyer: boolean;
  score: number;
  recent_skus: string[];
}>): StrategySelectionInput {
  return {
    session: { abandonmentScore: overrides.score ?? 0.6 },
    buyerHistory: {
      known_buyer: overrides.known_buyer ?? false,
      discount_sensitivity: overrides.discount_sensitivity ?? "low",
      recent_skus: overrides.recent_skus ?? ["sku_a", "sku_b"],
    },
    merchantRules: {
      allowFreeShipping: overrides.allowFreeShipping ?? false,
      maxDiscountPercent: overrides.maxDiscountPercent ?? 10,
    },
    abandonmentReason: overrides.reason ?? "unknown",
  };
}

// --- Tier 1: offer_free_shipping ---

test("S1 — Tier 1: shipping_cost + allowFreeShipping=true → offer_free_shipping", () => {
  const result = RecoveryStrategySelector.select(input({
    reason: "shipping_cost",
    allowFreeShipping: true,
  }));
  assert.equal(result.type, "offer_free_shipping");
});

test("S1b — Tier 1 wins over Tier 2: shipping_cost + allowFreeShipping=true + high sensitivity → still free shipping", () => {
  const result = RecoveryStrategySelector.select(input({
    reason: "shipping_cost",
    allowFreeShipping: true,
    discount_sensitivity: "high",
    known_buyer: true,
    score: 0.6,
  }));
  assert.equal(result.type, "offer_free_shipping");
});

test("S9b — shipping_cost + allowFreeShipping=FALSE → falls to Tier 4 (not Tier 1)", () => {
  const result = RecoveryStrategySelector.select(input({
    reason: "shipping_cost",
    allowFreeShipping: false,
    discount_sensitivity: "low",
    known_buyer: false,
    score: 0.5,
  }));
  // shipping_cost is still a specific reason → Tier 4 address_objection
  assert.equal(result.type, "address_objection");
  assert.notEqual(result.type, "offer_free_shipping");
});

// --- Tier 2: escalate_discount ---

test("S2 — Tier 2: price + discount_sensitivity=high → escalate_discount", () => {
  const result = RecoveryStrategySelector.select(input({
    reason: "price",
    discount_sensitivity: "high",
    score: 0.55,
  }));
  assert.equal(result.type, "escalate_discount");
  if (result.type === "escalate_discount") {
    assert.equal(result.value_percent, 10);
    assert.equal(result.cap, 10);
  }
});

test("S8 — Tier 2 respects cap: maxDiscountPercent=5 → value=5 (not 10)", () => {
  const result = RecoveryStrategySelector.select(input({
    reason: "price",
    discount_sensitivity: "high",
    maxDiscountPercent: 5,
    score: 0.55,
  }));
  assert.equal(result.type, "escalate_discount");
  if (result.type === "escalate_discount") {
    assert.equal(result.value_percent, 5);
    assert.equal(result.cap, 5);
  }
});

test("S3 — Tier 2: price + high sensitivity + allowFreeShipping (irrelevant for price reason) → Tier 2", () => {
  const result = RecoveryStrategySelector.select(input({
    reason: "price",
    allowFreeShipping: true,
    discount_sensitivity: "high",
    score: 0.55,
  }));
  // reason=price, not shipping_cost → Tier 1 NOT triggered, Tier 2 fires
  assert.equal(result.type, "escalate_discount");
});

// --- Tier 3: personalized_cross_sell ---

test("S4 — Tier 3: known_buyer + score >= 0.5 + no specific tier 1/2 match → personalized_cross_sell", () => {
  const result = RecoveryStrategySelector.select(input({
    reason: "hesitation",
    known_buyer: true,
    score: 0.55,
    discount_sensitivity: "low",
    recent_skus: ["sku_1", "sku_2", "sku_3", "sku_4"],
  }));
  assert.equal(result.type, "personalized_cross_sell");
  if (result.type === "personalized_cross_sell") {
    // Only first 3 skus
    assert.equal(result.suggested_skus.length, 3);
  }
});

test("Tier 3: known_buyer + score exactly 0.5 → personalized_cross_sell (boundary)", () => {
  const result = RecoveryStrategySelector.select(input({
    reason: "hesitation",
    known_buyer: true,
    score: 0.5,
    discount_sensitivity: "low",
  }));
  assert.equal(result.type, "personalized_cross_sell");
});

// --- Tier 4: address_objection ---

test("S5 — Tier 4: specific objection (trust) + not known + score < 0.5 → address_objection", () => {
  const result = RecoveryStrategySelector.select(input({
    reason: "trust",
    known_buyer: false,
    score: 0.49,
    discount_sensitivity: "low",
  }));
  assert.equal(result.type, "address_objection");
  if (result.type === "address_objection") {
    assert.equal(result.objection, "trust");
    assert.ok(result.response_template.length > 0);
  }
});

// --- Tier 5: wait_and_retry ---

test("S6 — Tier 5: unknown + score < 0.7 → wait_and_retry(60)", () => {
  const result = RecoveryStrategySelector.select(input({
    reason: "unknown",
    known_buyer: false,
    score: 0.5,
    discount_sensitivity: "low",
  }));
  assert.equal(result.type, "wait_and_retry");
  if (result.type === "wait_and_retry") {
    assert.equal(result.delay_minutes, 60);
  }
});

// --- Default: no_action ---

test("S7 — Default: unknown + score >= 0.7 → no_action (score too high for wait_and_retry)", () => {
  const result = RecoveryStrategySelector.select(input({
    reason: "unknown",
    known_buyer: false,
    score: 0.85,
    discount_sensitivity: "low",
  }));
  assert.equal(result.type, "no_action");
});

test("S9 — Tier 5 (not Tier 2): price + LOW sensitivity + score < 0.7 → Tier 4 address_objection (price is still a reason)", () => {
  // price + low sensitivity → Tier 2 condition fails.
  // known_buyer=false → Tier 3 condition fails.
  // abandonment_reason='price' (non-unknown) → Tier 4 fires.
  const result = RecoveryStrategySelector.select(input({
    reason: "price",
    discount_sensitivity: "low",
    known_buyer: false,
    score: 0.4,
  }));
  assert.equal(result.type, "address_objection");
});

// --- Inversion tests (adjacent pair priority assertions) ---

test("I1 — Tier 1 vs Tier 2: shipping_cost + allowFreeShipping + high sensitivity → Tier 1 wins", () => {
  const result = RecoveryStrategySelector.select(input({
    reason: "shipping_cost",
    allowFreeShipping: true,
    discount_sensitivity: "high",
    known_buyer: true,
    score: 0.6,
  }));
  assert.equal(result.type, "offer_free_shipping");
});

test("I2 — Tier 2 vs Tier 3: price + high sensitivity + known_buyer + score>=0.5 → Tier 2 wins", () => {
  const result = RecoveryStrategySelector.select(input({
    reason: "price",
    discount_sensitivity: "high",
    known_buyer: true,
    score: 0.6,
  }));
  assert.equal(result.type, "escalate_discount");
});

test("I3 — Tier 3 vs Tier 4: known_buyer + score>=0.5 + specific reason (hesitation) → Tier 3 wins", () => {
  // hesitation is a specific reason (non-unknown), so Tier 4 is reachable
  // But known_buyer=true + score>=0.5 → Tier 3 fires first
  const result = RecoveryStrategySelector.select(input({
    reason: "hesitation",
    known_buyer: true,
    score: 0.55,
    discount_sensitivity: "low",
  }));
  assert.equal(result.type, "personalized_cross_sell");
});

test("I4 — Tier 4 vs Tier 5: specific reason (trust) + unknown buyer + score < 0.7 → Tier 4 wins", () => {
  // trust is non-unknown → Tier 4 is reachable
  // score < 0.7 → Tier 5 is also reachable
  // Tier 4 should fire first
  const result = RecoveryStrategySelector.select(input({
    reason: "trust",
    known_buyer: false,
    score: 0.5,
    discount_sensitivity: "low",
  }));
  assert.equal(result.type, "address_objection");
});

test("I5 — Tier 5 vs default (no_action): unknown + score=0.69 → Tier 5 wins", () => {
  const result = RecoveryStrategySelector.select(input({
    reason: "unknown",
    known_buyer: false,
    score: 0.69,
    discount_sensitivity: "low",
  }));
  assert.equal(result.type, "wait_and_retry");
});
