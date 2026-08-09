import type {
  CheckoutEventName,
  ProgressiveDiscountPolicy,
  ProgressiveDiscountStage
} from "@zyon/shared-types";

export const DEFAULT_PROGRESSIVE_DISCOUNT_STAGES: Record<ProgressiveDiscountStage, number> = {
  initial_coupon: 5,
  exit_intent: 5,
  abandoned_cart: 10,
  payment_nudge: 15
};

export function resolveProgressiveDiscountStage(event: CheckoutEventName): ProgressiveDiscountStage | null {
  if (event === "coupon_field_clicked") return "initial_coupon";
  if (event === "exit_intent_detected" || event === "idle_30_seconds") return "exit_intent";
  if (event === "checkout_abandoned") return "abandoned_cart";
  if (event === "payment_method_selected" || event === "payment_failed") return "payment_nudge";
  return null;
}

export function selectProgressiveDiscountPercent(
  policy: ProgressiveDiscountPolicy | undefined,
  stage: ProgressiveDiscountStage | null
): number {
  if (!policy?.enabled || !stage) return 0;
  const configured = policy.stages?.[stage] ?? DEFAULT_PROGRESSIVE_DISCOUNT_STAGES[stage];
  return Number.isFinite(configured) ? Math.max(0, configured) : 0;
}
