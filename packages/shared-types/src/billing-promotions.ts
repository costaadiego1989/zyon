import type { BillingCycle } from "./billing-offers.js";

/** Public projection: no provider IDs, audit data or private coupons. */
export interface AutomaticBillingPromotion {
  code: string; name: string; plans: string[];
  discountType: "percent" | "fixed"; discountValue: number;
  duration: "once" | "repeating" | "forever"; durationMonths: number | null;
  startsAt: string; expiresAt: string; firstTimeOnly: boolean;
}
export function automaticBillingPromotion(promotions: AutomaticBillingPromotion[], plan: string, cycle: BillingCycle, now = Date.now()): AutomaticBillingPromotion | undefined {
  if (plan === "starter" || cycle !== "monthly") return undefined;
  // API returns newest campaigns first. Discounts never stack.
  return promotions.find(p => p.plans.includes(plan) && Date.parse(p.startsAt) <= now && Date.parse(p.expiresAt) > now);
}
export function promotionalBillingPrice(baseCents: number, promotion: AutomaticBillingPromotion): number {
  const discount = promotion.discountType === "percent" ? Math.round(baseCents * promotion.discountValue / 10000) : promotion.discountValue;
  return Math.max(0, baseCents - discount);
}
export function billingPromotionDuration(promotion: AutomaticBillingPromotion): string {
  return promotion.duration === "once" ? "na primeira mensalidade" : promotion.duration === "repeating" ? `nos ${promotion.durationMonths} primeiros meses` : "enquanto a assinatura existir";
}
