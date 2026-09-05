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
  | "whiteLabel"
  | "publicApiV1"
  | "abTests"
  | "marketplace"
  | "intentMemory"
  | "revenueLift"
  // Growth+ (regras avançadas, integrações, IA de conteúdo/retenção)
  | "advancedRules"
  | "knowledgeBase"
  | "postSale"
  | "customDomain"
  | "crmIntegrations"
  | "aiSpreadsheetImport"
  // Scale (otimização autônoma + M2M)
  | "revenueManager"
  | "m2mAgents";

export type BillingPlanLimits = Record<BillingPlanLimitKey, number | null>;
export type BillingPlanFeatures = Record<BillingPlanFeatureKey, boolean>;

export type BillingPlanConfig = {
  name: string;
  monthlyPriceBrl: number;
  /** Fee do MERCHANT por transação, fixo em centavos (sai do repasse/hold). */
  transactionFeeCents: number;
  limits: BillingPlanLimits;
  features: BillingPlanFeatures;
};

/**
 * Taxa de serviço do BUYER, fixa em centavos (R$0,99). Modelo iFood: cobrada do
 * comprador (somada ao total do pedido) em todos os planos e métodos de
 * pagamento. Independe do plano do merchant. Receita da plataforma, separada do
 * fee de transação do merchant.
 */
export const BUYER_SERVICE_FEE_CENTS = 99;

const UNLIMITED = null;

export const BILLING_PLANS: Record<BillingPlan, BillingPlanConfig> = {
  starter: {
    name: "Free",
    monthlyPriceBrl: 0,
    transactionFeeCents: 299,
    limits: {
      ordersPerMonth: 100,
      sessionsPerMonth: 100,
      aiConversationsPerMonth: 100,
      commerceConnections: 1,
      webhookEndpoints: UNLIMITED,
      teamMembers: 1,
      crossSellPromotions: 1,
      activeCoupons: 1,
    },
    features: {
      customAgentName: true,
      customTheme: true,
      voiceCheckout: false,
      faceBiometry: false,
      cryptoPayments: false,
      whiteLabel: false, // Free mostra o badge "Powered by Zyon"
      publicApiV1: false,
      abTests: false,
      marketplace: false,
      intentMemory: false,
      revenueLift: false,
      advancedRules: false,
      knowledgeBase: false,
      postSale: false,
      customDomain: false,
      crmIntegrations: false,
      aiSpreadsheetImport: false,
      revenueManager: false,
      m2mAgents: false,
    },
  },
  growth: {
    name: "Growth",
    monthlyPriceBrl: 249,
    transactionFeeCents: 149,
    limits: {
      ordersPerMonth: 500,
      sessionsPerMonth: 1_000,
      aiConversationsPerMonth: 5_000,
      commerceConnections: 2,
      webhookEndpoints: UNLIMITED,
      teamMembers: 3,
      crossSellPromotions: 10,
      activeCoupons: 10,
    },
    features: {
      customAgentName: true,
      customTheme: true,
      voiceCheckout: true,
      faceBiometry: true,
      cryptoPayments: true,
      whiteLabel: true, // paga = remove badge
      publicApiV1: true,
      abTests: false,
      marketplace: false,
      intentMemory: false,
      revenueLift: false,
      advancedRules: true,
      knowledgeBase: true,
      postSale: true,
      customDomain: true,
      crmIntegrations: true,
      aiSpreadsheetImport: true,
      revenueManager: false,
      m2mAgents: false,
    },
  },
  scale: {
    name: "Scale",
    monthlyPriceBrl: 599,
    transactionFeeCents: 99,
    limits: {
      ordersPerMonth: UNLIMITED,
      sessionsPerMonth: UNLIMITED,
      aiConversationsPerMonth: UNLIMITED,
      commerceConnections: UNLIMITED,
      webhookEndpoints: UNLIMITED,
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
      publicApiV1: true,
      abTests: true,
      marketplace: true,
      intentMemory: true,
      revenueLift: true,
      advancedRules: true,
      knowledgeBase: true,
      postSale: true,
      customDomain: true,
      crmIntegrations: true,
      aiSpreadsheetImport: true,
      revenueManager: true,
      m2mAgents: true,
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
