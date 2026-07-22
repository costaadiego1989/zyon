import type { BillingPlan, BillingSubscriptionSnapshot } from "./payment-platform.types.js";

export type BillingPlanLimitKey =
  | "ordersPerMonth"
  | "sessionsPerMonth"
  | "aiConversationsPerMonth"
  | "commerceConnections"
  | "webhookEndpoints"
  | "teamMembers"
  | "crossSellPromotions"
  | "activeCoupons";

export type BillingPlanFeatureKey =
  | "customAgentName"
  | "customTheme"
  | "voiceCheckout"
  | "faceBiometry"
  | "cryptoPayments"
  | "whiteLabel";

export type BillingPlanLimits = Record<BillingPlanLimitKey, number | null>;
export type BillingPlanFeatures = Record<BillingPlanFeatureKey, boolean>;

export type BillingPlanConfig = {
  name: string;
  monthlyPriceBrl: number;
  transactionFeePercent: number;
  limits: BillingPlanLimits;
  features: BillingPlanFeatures;
};

const UNLIMITED = null;

export const BILLING_PLANS: Record<BillingPlan, BillingPlanConfig> = {
  starter: {
    name: "Starter",
    monthlyPriceBrl: 0,
    transactionFeePercent: 1.99,
    limits: {
      ordersPerMonth: 50,
      sessionsPerMonth: 50,
      aiConversationsPerMonth: 100,
      commerceConnections: 1,
      webhookEndpoints: 1,
      teamMembers: 1,
      crossSellPromotions: 2,
      activeCoupons: 3,
    },
    features: {
      customAgentName: false,
      customTheme: false,
      voiceCheckout: false,
      faceBiometry: false,
      cryptoPayments: false,
      whiteLabel: false,
    },
  },
  growth: {
    name: "Growth",
    monthlyPriceBrl: 99,
    transactionFeePercent: 1.49,
    limits: {
      ordersPerMonth: 500,
      sessionsPerMonth: 1_000,
      aiConversationsPerMonth: 5_000,
      commerceConnections: 3,
      webhookEndpoints: 5,
      teamMembers: 3,
      crossSellPromotions: 10,
      activeCoupons: 20,
    },
    features: {
      customAgentName: true,
      customTheme: true,
      voiceCheckout: true,
      faceBiometry: false,
      cryptoPayments: false,
      whiteLabel: false,
    },
  },
  scale: {
    name: "Scale",
    monthlyPriceBrl: 299,
    transactionFeePercent: 0.99,
    limits: {
      ordersPerMonth: UNLIMITED,
      sessionsPerMonth: UNLIMITED,
      aiConversationsPerMonth: UNLIMITED,
      commerceConnections: UNLIMITED,
      webhookEndpoints: 20,
      teamMembers: 10,
      crossSellPromotions: UNLIMITED,
      activeCoupons: UNLIMITED,
    },
    features: {
      customAgentName: true,
      customTheme: true,
      voiceCheckout: true,
      faceBiometry: true,
      cryptoPayments: true,
      whiteLabel: true,
    },
  },
};

export function planFromPriceId(
  stripePriceId: string | undefined,
  priceIds: Partial<Record<BillingPlan, string>> = {
    starter: process.env.STRIPE_BILLING_PRICE_STARTER,
    growth: process.env.STRIPE_BILLING_PRICE_GROWTH,
    scale: process.env.STRIPE_BILLING_PRICE_SCALE,
  },
): BillingPlan | undefined {
  const priceId = stripePriceId?.trim();
  if (!priceId) return undefined;
  for (const plan of Object.keys(BILLING_PLANS) as BillingPlan[]) {
    if (priceIds[plan]?.trim() === priceId) return plan;
  }
  if (priceId === "starter" || priceId === "growth" || priceId === "scale") return priceId;
  return undefined;
}

export function effectiveBillingPlan(
  subscription: Pick<BillingSubscriptionSnapshot, "status" | "trialEndsAt" | "stripePriceId"> | undefined,
  now = new Date(),
): BillingPlan {
  if (!subscription) return "starter";
  const trialActive = subscription.status === "trialing" &&
    Boolean(subscription.trialEndsAt) &&
    new Date(subscription.trialEndsAt!).getTime() > now.getTime();
  if (trialActive) return "growth";
  if (subscription.status !== "active") return "starter";
  return planFromPriceId(subscription.stripePriceId) ?? "starter";
}

export function transactionFeePercentFor(
  subscription: Pick<BillingSubscriptionSnapshot, "status" | "trialEndsAt" | "stripePriceId"> | undefined,
  now = new Date(),
): number {
  if (subscription?.status === "trialing") return BILLING_PLANS.starter.transactionFeePercent;
  return BILLING_PLANS[effectiveBillingPlan(subscription, now)].transactionFeePercent;
}

export function calculatePlatformFeeCents(orderAmountCents: number, feePercent: number): number {
  const amount = Math.max(0, Math.trunc(orderAmountCents));
  const percent = Math.max(0, feePercent);
  return Math.round(amount * (percent / 100));
}

export function assertProviderFeeCap(platformFeeCents: number, providerFeeCents: number): number {
  return Math.max(0, Math.min(platformFeeCents, Math.max(0, providerFeeCents)));
}
