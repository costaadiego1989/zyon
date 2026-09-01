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
  pendingPlanKey?: BillingSubscriptionSnapshot["planKey"];
  pendingPlanEffectiveAt?: string | null;
}

export interface PaymentPlatformRepository {
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
