import type { BillingCycle } from "@zyon/shared-types";
import type {
  BillingSubscriptionSnapshot,
  PaymentConnectionEnvironment,
  PaymentConnectionProvider,
  PaymentConnectionSnapshot,
  PaymentConnectionStatus,
} from "../payment-platform.types.js";

export const PAYMENT_PLATFORM_REPOSITORY = Symbol(
  "PAYMENT_PLATFORM_REPOSITORY",
);

export interface SavePaymentConnectionInput {
  merchantId: string;
  provider: PaymentConnectionProvider;
  environment: PaymentConnectionEnvironment;
  status: PaymentConnectionStatus;
  externalAccountId?: string;
  secret?: string;
  walletId?: string;
  chargesEnabled?: boolean;
  payoutsEnabled?: boolean;
  requirements?: string[];
  syncedAt?: string;
  errorCode?: string;
}

export interface SaveBillingSubscriptionInput {
  merchantId: string;
  stripeCustomerId?: string;
  stripeSubscriptionId?: string;
  stripePriceId?: string;
  status?: BillingSubscriptionSnapshot["status"];
  trialEndsAt?: string;
  currentPeriodEnd?: string;
  cancelAtPeriodEnd?: boolean;
  // Asaas billing
  provider?: "asaas" | "stripe";
  planKey?: BillingSubscriptionSnapshot["planKey"];
  asaasCustomerId?: string;
  asaasSubscriptionId?: string;
  pendingPlanKey?: BillingSubscriptionSnapshot["planKey"] | null;
  pendingPlanEffectiveAt?: string | null;
  providerCancellationScheduledAt?: string | null;
  pendingUpgradePlanKey?: BillingSubscriptionSnapshot["planKey"] | null;
  pendingUpgradeAmountCents?: number | null;
  pendingUpgradeRequestedAt?: string | null;
  billingAmountCents?: number | null;
  billingCycle?: BillingCycle;
  billingDiscountPercent?: number;
  pendingBillingCycle?: BillingCycle | null;
  pendingBillingAmountCents?: number | null;
  pendingBillingDiscountPercent?: number | null;
  lastBillingEventAt?: string | null;
  lastBillingPaymentId?: string | null;
  lastBillingPaymentDueAt?: string | null;
}

export interface BillingWebhookMutation {
  eventId: string;
  merchantId: string;
  subscriptionId: string;
  paymentId?: string;
  occurredAt: string;
}

/** Synchronous decision evaluated against a locked billing snapshot. No remote IO. */
export type BillingMutation = (current: BillingSubscriptionSnapshot) => SaveBillingSubscriptionInput | undefined;
export type BillingWebhookOutcome = "processed" | "duplicate" | "ignored";

export interface PaymentPlatformRepository {
  mutateBilling(merchantId: string, decide: BillingMutation): Promise<BillingSubscriptionSnapshot | undefined>;
  processBillingWebhook(input: BillingWebhookMutation, decide: BillingMutation): Promise<BillingWebhookOutcome>;
  listConnections(merchantId: string): Promise<PaymentConnectionSnapshot[]>;
  getConnection(
    merchantId: string,
    provider: PaymentConnectionProvider,
  ): Promise<PaymentConnectionSnapshot | undefined>;
  getConnectionSecret(
    merchantId: string,
    provider: PaymentConnectionProvider,
  ): Promise<string | undefined>;
  saveConnection(input: SavePaymentConnectionInput): Promise<void>;
  deleteConnection(merchantId: string, provider: PaymentConnectionProvider): Promise<void>;
  getOrCreateTrial(
    merchantId: string,
    trialDays: number,
  ): Promise<BillingSubscriptionSnapshot>;
  saveBilling(input: SaveBillingSubscriptionInput): Promise<void>;
  getBilling(
    merchantId: string,
  ): Promise<BillingSubscriptionSnapshot | undefined>;
  listBillingCancellationsNeedingProviderSuspend(
    limit: number,
  ): Promise<BillingSubscriptionSnapshot[]>;
  listDueBillingCancellations(
    now: Date,
    limit: number,
  ): Promise<BillingSubscriptionSnapshot[]>;
  expireTrial(merchantId: string, now: Date): Promise<boolean>;
  expireTrials(now: Date, limit: number): Promise<number>;
  findMerchantByStripeCustomerId(
    customerId: string,
  ): Promise<string | undefined>;
  findMerchantByStripeSubscriptionId(
    subscriptionId: string,
  ): Promise<string | undefined>;
  findMerchantByAsaasSubscriptionId(
    subscriptionId: string,
  ): Promise<string | undefined>;
}
