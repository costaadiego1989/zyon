import type { CheckoutEventName } from "@zyon/shared-types";

const EVENT_WEIGHTS: Record<CheckoutEventName, number> = {
  checkout_started: 0.05,
  cart_viewed: 0.05,
  product_viewed: 0.02,
  shipping_calculated: 0.12,
  shipping_option_selected: 0.08,
  shipping_objection_detected: 0.35,
  coupon_field_clicked: 0.22,
  coupon_applied: -0.1,
  payment_method_selected: 0.04,
  payment_failed: 0.3,
  exit_intent_detected: 0.3,
  // The persisted trigger name is legacy, but the storefront now fires it
  // after five minutes. That level of inactivity is enough to qualify a cart
  // for recovery; the scanner still revalidates cart, payment and consent.
  idle_30_seconds: 0.55,
  offer_viewed: 0.05,
  offer_accepted: -0.15,
  order_completed: -1,
  // Closing checkout is an explicit abandonment signal and must independently
  // reach the Cart Recovery threshold.
  checkout_abandoned: 0.55,
  cross_sell_accepted: -0.1,
  cross_sell_added: -0.05,
  auth_phone_submitted: 0.05,
  auth_phone_verified: -0.05,
  auth_identity_confirmed: -0.05,
  auth_registration_completed: -0.1,
  login_completed: -0.08,
  channel_selected: 0.02,
  item_quantity_updated: 0.03,
  item_removed: 0.15,
  session_start: 0.02,
  message_sent: 0.01,
};

export function scoreEvent(currentScore: number, event: CheckoutEventName): number {
  return clamp(currentScore + EVENT_WEIGHTS[event], 0, 1);
}

export function decideIntervention(score: number): { trigger: boolean; reason: string } {
  if (score >= 0.7) return { trigger: true, reason: "high_abandonment_score" };
  if (score >= 0.55) return { trigger: true, reason: "moderate_hesitation_detected" };
  return { trigger: false, reason: "below_intervention_threshold" };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
