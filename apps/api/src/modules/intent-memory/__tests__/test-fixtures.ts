/**
 * Test fixtures for intent-memory module
 * LGPD Art. 8 (consent), Art. 18 (erasure), Art. 6 (minimization)
 */

import type { BuyerIntentMemoryConsent, CustomerIntentRecord } from "@zyon/shared-types";

export function buyerIntentMemoryConsent(
  overrides: Partial<BuyerIntentMemoryConsent> = {}
): BuyerIntentMemoryConsent {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000); // 1 year from now

  return {
    merchant_id: "mrc_1",
    global_user_id: "usr_1",
    opted_in: true,
    expires_at: expiresAt.toISOString(),
    updated_at: now.toISOString(),
    ...overrides
  };
}

export function customerIntentRecord(
  overrides: Partial<CustomerIntentRecord> = {}
): CustomerIntentRecord {
  const now = new Date();
  return {
    id: "intent_1",
    merchant_id: "mrc_1",
    global_user_id: "usr_1",
    primary_intent: "price_sensitive",
    urgency: "high",
    budget_tier: "budget",
    category_focus: ["footwear"],
    pain_points: ["shipping_cost"],
    conversion_likelihood_percent: 45,
    behavioral_signals: {
      session_duration_seconds: 300,
      items_viewed: 5,
      comparisons_made: 2,
      objections_raised: 1,
      checkout_stage_reached: 1,
      last_objection_type: "shipping_cost"
    },
    generated_at: now.toISOString(),
    ...overrides
  };
}

export function expiredConsent(
  overrides: Partial<BuyerIntentMemoryConsent> = {}
): BuyerIntentMemoryConsent {
  const now = new Date();
  const expiredAt = new Date(now.getTime() - 1 * 24 * 60 * 60 * 1000); // 1 day ago

  return buyerIntentMemoryConsent({
    expires_at: expiredAt.toISOString(),
    ...overrides
  });
}

export function revokedConsent(
  overrides: Partial<BuyerIntentMemoryConsent> = {}
): BuyerIntentMemoryConsent {
  return buyerIntentMemoryConsent({
    opted_in: false,
    ...overrides
  });
}
