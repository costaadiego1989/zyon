import test from "node:test";
import assert from "node:assert/strict";
import { AbandonmentReasonClassifier } from "../domain/services/abandonment-reason-classifier.service.js";

// C1 — Last event shipping_objection_detected → shipping_cost
test("C1 — shipping_objection_detected → shipping_cost", () => {
  const result = AbandonmentReasonClassifier.classify(["page_viewed", "shipping_objection_detected"]);
  assert.equal(result, "shipping_cost");
});

// C2 — Last event coupon_field_clicked → price
test("C2 — coupon_field_clicked → price", () => {
  const result = AbandonmentReasonClassifier.classify(["page_viewed", "coupon_field_clicked"]);
  assert.equal(result, "price");
});

// C3 — Last event payment_failed → payment
test("C3 — payment_failed → payment", () => {
  const result = AbandonmentReasonClassifier.classify(["checkout_started", "payment_failed"]);
  assert.equal(result, "payment");
});

// C4 — Chain [exit_intent, idle_30s] → hesitation (when no mapped event wins)
test("C4 — exit_intent + idle_30s chain without mapped terminal event → hesitation", () => {
  const result = AbandonmentReasonClassifier.classify(["checkout_abandoned", "exit_intent_detected", "idle_30s"]);
  assert.equal(result, "hesitation");
});

// C5 — checkout_abandoned only → unknown (no mapped event, no hesitation signals)
test("C5 — checkout_abandoned only → unknown", () => {
  const result = AbandonmentReasonClassifier.classify(["checkout_abandoned"]);
  assert.equal(result, "unknown");
});

// C6 — Unrelated event sequence → unknown
test("C6 — unrelated events → unknown", () => {
  const result = AbandonmentReasonClassifier.classify(["page_viewed", "product_clicked", "scroll_depth_50"]);
  assert.equal(result, "unknown");
});

// C7 — Chain [shipping_objection_detected, coupon_field_clicked] → price (last event wins)
test("C7 — shipping then coupon: last relevant event (coupon_field_clicked) wins → price", () => {
  const result = AbandonmentReasonClassifier.classify(["shipping_objection_detected", "coupon_field_clicked"]);
  assert.equal(result, "price");
});

// C8 — Empty event log → unknown
test("C8 — empty event log → unknown", () => {
  assert.equal(AbandonmentReasonClassifier.classify([]), "unknown");
});

// Additional: null-safe
test("C8b — undefined-ish events → unknown", () => {
  assert.equal(AbandonmentReasonClassifier.classify(undefined as unknown as string[]), "unknown");
});

// C13 — exit_intent_detected + high score → hesitation (chain check)
test("C13 — exit_intent_detected in chain (not last event, but in history) → hesitation", () => {
  const result = AbandonmentReasonClassifier.classify(["exit_intent_detected", "page_viewed"]);
  assert.equal(result, "hesitation");
});

// Trust objection
test("trust_objection_detected → trust", () => {
  const result = AbandonmentReasonClassifier.classify(["page_viewed", "trust_objection_detected"]);
  assert.equal(result, "trust");
});
