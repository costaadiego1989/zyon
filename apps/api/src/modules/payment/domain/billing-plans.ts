import type { BillingPlan, BillingSubscriptionSnapshot } from "./payment-platform.types.js";

import { BILLING_PLANS, type BillingPlanFeatureKey } from "@zyon/shared-types";
export { BILLING_PLANS, BUYER_SERVICE_FEE_CENTS, BILLING_PLAN_PRESENTATION } from "@zyon/shared-types";
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
  for (const plan of ["growth", "scale"] as const) {
    const key = "STRIPE_BILLING_PRICE_" + plan.toUpperCase() + "_ANNUAL";
    if (process.env[key]?.trim() === priceId || process.env[key + "_LEGACY"]?.split(",").some(id => id.trim() === priceId)) return plan;
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

/**
 * Resolves an entitlement from either a persisted Prisma row or a billing
 * snapshot. Public hostname resolution uses this before serving a custom
 * domain, so a previously verified domain does not outlive its plan access.
 */
export function isBillingFeatureEnabled(
  subscription: {
    status?: string | null;
    trialEndsAt?: string | Date | null;
    stripePriceId?: string | null;
    planKey?: string | null;
  } | null | undefined,
  feature: BillingPlanFeatureKey,
  now = new Date(),
): boolean {
  if (!subscription) return false;
  const trialEndsAt = subscription.trialEndsAt instanceof Date
    ? subscription.trialEndsAt.toISOString()
    : subscription.trialEndsAt ?? undefined;
  const planKey = subscription.planKey === "growth" || subscription.planKey === "scale"
    ? subscription.planKey
    : "starter";
  const status = subscription.status === "active" || subscription.status === "trialing"
    ? subscription.status
    : "starter";
  const plan = effectiveBillingPlan({
    status,
    trialEndsAt,
    stripePriceId: subscription.stripePriceId ?? undefined,
    planKey,
  }, now);
  return BILLING_PLANS[plan].features[feature];
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

export function cycleFromPriceId(priceId: string | undefined): "monthly" | "annual" {
  if (priceId) for (const plan of ["GROWTH", "SCALE"]) {
    const key = "STRIPE_BILLING_PRICE_" + plan + "_ANNUAL";
    if (process.env[key]?.trim() === priceId || process.env[key + "_LEGACY"]?.split(",").some(id => id.trim() === priceId)) return "annual";
  }
  return "monthly";
}
