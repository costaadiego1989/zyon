/**
 * Discriminated union of recovery strategies.
 * Strategy selection is deterministic (no LLM).
 */
export type RecoveryStrategy =
  | { type: "offer_free_shipping"; condition: "merchant_allows_free_shipping" }
  | { type: "escalate_discount"; value_percent: number; cap: number }
  | { type: "personalized_cross_sell"; suggested_skus: string[] }
  | { type: "offer_coupon"; coupon_code?: string; coupon_percent?: number }
  | { type: "advanced_rule"; rule_id?: string; description?: string }
  | { type: "address_objection"; objection: string; response_template: string }
  | { type: "wait_and_retry"; delay_minutes: number }
  | { type: "no_action"; reason: string };

export type RecoveryStrategyType = RecoveryStrategy["type"];

/**
 * Dashboard config — which strategy is active + its config (coupon code, rule ID).
 */
export interface StrategyConfig {
  active_strategy: "offer_free_shipping" | "personalized_cross_sell" | "offer_coupon" | "advanced_rule";
  coupon_code?: string;
  rule_id?: string;
}

/**
 * Toggleable strategy preferences per merchant.
 * Only ONE should be active at a time — the dashboard enforces radio selection.
 * `escalate_discount` (legacy) and `no_action` (sentinel) are not toggleable.
 */
export type ToggleableStrategyKey =
  | "offer_free_shipping"
  | "personalized_cross_sell"
  | "offer_coupon"
  | "advanced_rule";

export const TOGGLEABLE_STRATEGY_KEYS: readonly ToggleableStrategyKey[] = [
  "offer_free_shipping",
  "personalized_cross_sell",
  "offer_coupon",
  "advanced_rule",
] as const;

export type StrategyPreferences = Record<ToggleableStrategyKey, boolean>;

export function defaultStrategyPreferences(): StrategyPreferences {
  return {
    offer_free_shipping: false,
    personalized_cross_sell: false,
    offer_coupon: true,
    advanced_rule: false,
  };
}

/**
 * Normalize a raw input (e.g. from JSON column or PATCH body) into a
 * StrategyPreferences record. Unknown keys are dropped; missing keys fall
 * back to defaults. Enforces radio constraint: if multiple are true, only
 * the first true key wins.
 */
export function normalizeStrategyPreferences(
  raw: Record<string, unknown> | null | undefined,
): StrategyPreferences {
  const defaults = defaultStrategyPreferences();
  if (!raw || typeof raw !== "object") return defaults;

  const result: StrategyPreferences = {
    offer_free_shipping: false,
    personalized_cross_sell: false,
    offer_coupon: false,
    advanced_rule: false,
  };

  let found = false;
  for (const key of TOGGLEABLE_STRATEGY_KEYS) {
    const v = raw[key];
    if (typeof v === "boolean" && v && !found) {
      result[key] = true;
      found = true;
    }
  }

  if (!found) {
    result.offer_coupon = true;
  }

  return result;
}
