import type { BillingSubscriptionStatus } from "../../../payment/domain/payment-platform.types.js";

export const PLATFORM_BILLING_SUBSCRIPTION_REPOSITORY = Symbol("PLATFORM_BILLING_SUBSCRIPTION_REPOSITORY");

export type LocalBillingProvider = "asaas" | "stripe" | "mercadopago" | "unknown";

export type PlatformBillingSubscriptionQuery = {
  cursor?: string;
  limit: number;
  status?: BillingSubscriptionStatus;
  provider?: LocalBillingProvider;
  asOf: Date;
};

export type PlatformBillingSubscription = {
  merchantId: string;
  merchantName: string;
  provider: LocalBillingProvider;
  status: BillingSubscriptionStatus;
  planKey?: "starter" | "growth" | "scale";
  billingCycle: "monthly" | "annual";
  billingAmountCents?: number;
  termEndsAt?: Date;
  termEndKind?: "trial" | "billing_period";
  cancelAtPeriodEnd: boolean;
  providerCancellationScheduledAt?: Date;
  lastBillingEventAt?: Date;
  createdAt: Date;
  updatedAt: Date;
};

export type PlatformBillingSubscriptionSummary = {
  totalRecords: number;
  recordsByStatus: Record<string, number>;
  activeLocalRecords: number;
  activeTrials: number;
  pastDueLocalStateRecords: number;
  cancellationAtPeriodEndRecords: number;
  missingTermEndRecords: number;
};

export type PlatformBillingSubscriptionPage = {
  items: PlatformBillingSubscription[];
  summary: PlatformBillingSubscriptionSummary;
  nextCursor?: string;
};

export type PlatformBillingSubscriptionsReadAudit = {
  actorOperatorId: string;
  correlationId: string;
  environment: string;
  returnedItems: number;
  totalRecords: number;
  status?: BillingSubscriptionStatus;
  provider?: LocalBillingProvider;
};

export interface PlatformBillingSubscriptionRepository {
  list(input: PlatformBillingSubscriptionQuery): Promise<PlatformBillingSubscriptionPage>;
  recordRead(input: PlatformBillingSubscriptionsReadAudit): Promise<void>;
}
