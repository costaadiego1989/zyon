import type { BillingPlan, BillingSubscriptionSnapshot } from "./payment-platform.types.js";

import { BILLING_PLANS } from "@zyon/shared-types";
export { BILLING_PLANS, BUYER_SERVICE_FEE_CENTS } from "@zyon/shared-types";
export type { BillingPlanConfig, BillingPlanLimitKey, BillingPlanFeatureKey, BillingPlanLimits, BillingPlanFeatures } from "@zyon/shared-types";

export function planFromPriceId(
  stripePriceId: string | undefined,
  priceIds: Partial<Record<BillingPlan, string>> = {
    starter: process.env.STRIPE_BILLING_PRICE_STARTER,
    growth: process.env.STRIPE_BILLING_PRICE_GROWTH,
    scale: process.env.STRIPE_BILLING_PRICE_SCALE,
  },
  legacyPriceIds: Partial<Record<BillingPlan, string>> = {
    starter: process.env.STRIPE_BILLING_PRICE_STARTER_LEGACY,
    growth: process.env.STRIPE_BILLING_PRICE_GROWTH_LEGACY,
    scale: process.env.STRIPE_BILLING_PRICE_SCALE_LEGACY,
  },
): BillingPlan | undefined {
  const priceId = stripePriceId?.trim();
  if (!priceId) return undefined;
  for (const plan of Object.keys(BILLING_PLANS) as BillingPlan[]) {
    if (priceIds[plan]?.trim() === priceId) return plan;
  }
  // Keep existing subscriptions/webhooks mapped while provider prices migrate.
  for (const plan of Object.keys(BILLING_PLANS) as BillingPlan[]) {
    if (legacyPriceIds[plan]?.split(",").some((id) => id.trim() === priceId)) return plan;
  }
  if (priceId === "starter" || priceId === "growth" || priceId === "scale") return priceId;
  return undefined;
}

export function effectiveBillingPlan(
  subscription: Pick<BillingSubscriptionSnapshot, "status" | "trialEndsAt" | "stripePriceId" | "planKey"> | undefined,
  now = new Date(),
): BillingPlan {
  if (!subscription) return "starter";
  const trialActive = subscription.status === "trialing" &&
    Boolean(subscription.trialEndsAt) &&
    new Date(subscription.trialEndsAt!).getTime() > now.getTime();
  if (trialActive) return "starter";
  if (subscription.status !== "active") return "starter";
  return planFromPriceId(subscription.stripePriceId) ?? subscription.planKey ?? "starter";
}

export function freeTrialState(
  subscription: Pick<BillingSubscriptionSnapshot, "status" | "trialEndsAt" | "stripePriceId" | "planKey"> | undefined,
  now = new Date(),
) {
  const end = subscription?.trialEndsAt ? new Date(subscription.trialEndsAt).getTime() : null;
  const active = subscription?.status === "trialing" && end !== null && end > now.getTime();
  const expired = effectiveBillingPlan(subscription, now) === "starter" && !active &&
    (subscription?.status === "starter" || (end !== null && end <= now.getTime()));
  return { active, expired, daysRemaining: active ? Math.ceil((end! - now.getTime()) / 86_400_000) : 0 };
}

/**
 * Fee do MERCHANT por transação, fixo em centavos, para a assinatura dada.
 * Descontado no split do provedor. O Free não cobra essa taxa durante o trial.
 */
export function merchantTransactionFeeCentsFor(
  subscription: Pick<BillingSubscriptionSnapshot, "status" | "trialEndsAt" | "stripePriceId" | "planKey"> | undefined,
  now = new Date(),
): number {
  return freeTrialState(subscription, now).active ? 0 : BILLING_PLANS[effectiveBillingPlan(subscription, now)].transactionFeeCents;
}

export function assertProviderFeeCap(platformFeeCents: number, providerFeeCents: number): number {
  return Math.max(0, Math.min(platformFeeCents, Math.max(0, providerFeeCents)));
}
