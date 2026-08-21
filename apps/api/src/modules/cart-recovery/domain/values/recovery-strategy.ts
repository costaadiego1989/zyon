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

/**
 * Toggleable strategy preferences per merchant. Excludes `escalate_discount`
 * (progressive discounts handled by rules engine) and `no_action`
 * (a sentinel, not a strategy preference).
 */
export type ToggleableStrategyKey =
  | "offer_free_shipping"
  | "personalized_cross_sell"
  | "address_objection"
  | "wait_and_retry";

export const TOGGLEABLE_STRATEGY_KEYS: readonly ToggleableStrategyKey[] = [
  "offer_free_shipping",
  "personalized_cross_sell",
  "address_objection",
  "wait_and_retry",
] as const;

export type StrategyPreferences = Record<ToggleableStrategyKey, boolean>;

export function defaultStrategyPreferences(): StrategyPreferences {
  return {
    offer_free_shipping: true,
    personalized_cross_sell: true,
    address_objection: true,
    wait_and_retry: true,
  };
}

/**
 * Normalize a raw input (e.g. from JSON column or PATCH body) into a
 * StrategyPreferences record. Unknown keys are dropped; missing keys fall
 * back to defaults (true). `escalate_discount` is always excluded.
 */
export function normalizeStrategyPreferences(
  raw: Record<string, unknown> | null | undefined,
): StrategyPreferences {
  const defaults = defaultStrategyPreferences();
  if (!raw || typeof raw !== "object") return defaults;
  for (const key of TOGGLEABLE_STRATEGY_KEYS) {
    const v = raw[key];
    if (typeof v === "boolean") {
      defaults[key] = v;
    }
  }
  return defaults;
}
