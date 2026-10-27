export type StackingInput = {
  crossSellDiscountPercent: number;
  couponDiscountPercent: number;
  negotiationDiscountPercent: number;
  maxDiscountPercent: number;
};

export type StackingResult =
  | { allowed: true; totalDiscountPercent: number }
  | { allowed: false; reason: "DISCOUNT_CAP_EXCEEDED"; totalDiscountPercent: number; capPercent: number };

export function evaluateStacking(input: StackingInput): StackingResult {
  const total = input.crossSellDiscountPercent + input.couponDiscountPercent + input.negotiationDiscountPercent;
  if (total > input.maxDiscountPercent) {
    return { allowed: false, reason: "DISCOUNT_CAP_EXCEEDED", totalDiscountPercent: total, capPercent: input.maxDiscountPercent };
  }
  return { allowed: true, totalDiscountPercent: total };
}
