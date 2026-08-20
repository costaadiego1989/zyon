/**
 * Discriminated union of recovery strategies.
 * Strategy selection is deterministic (no LLM).
 */
export type RecoveryStrategy =
  | { type: "offer_free_shipping"; condition: "merchant_allows_free_shipping" }
  | { type: "escalate_discount"; value_percent: number; cap: number }
  | { type: "personalized_cross_sell"; suggested_skus: string[] }
  | { type: "address_objection"; objection: string; response_template: string }
  | { type: "wait_and_retry"; delay_minutes: number }
  | { type: "no_action"; reason: string };

export type RecoveryStrategyType = RecoveryStrategy["type"];
