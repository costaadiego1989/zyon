export const PLATFORM_BILLING_RECEIVABLE_REPOSITORY = Symbol("PLATFORM_BILLING_RECEIVABLE_REPOSITORY");

export type PlatformBillingReceivableStatus = "open" | "overdue" | "paid" | "cancelled" | "refunded";

export type PlatformBillingReceivableQuery = {
  cursor?: string;
  limit: number;
  status?: PlatformBillingReceivableStatus;
};

export type PlatformBillingReceivable = {
  id: string;
  merchantId: string;
  merchantName: string;
  provider: "asaas" | "stripe" | "mercadopago";
  providerPaymentId: string;
  providerSubscriptionId: string;
  status: PlatformBillingReceivableStatus;
  currency: string;
  amountCents?: number;
  dueAt?: Date;
  paidAt?: Date;
  firstObservedAt: Date;
  lastProviderEventAt: Date;
};

export type PlatformBillingReceivableSummary = {
  observedReceivableCount: number;
  observedSince?: Date;
  openCount: number;
  openBalanceCents?: string;
  overdueCount: number;
  overdueMerchantCount: number;
  overdueBalanceCents?: string;
  dueTodayCount: number;
  dueTodayBalanceCents?: string;
  dueNext7DaysCount: number;
  dueNext7DaysBalanceCents?: string;
  nextDueAt?: Date;
  paymentConfirmedCount: number;
  paymentConfirmedAmountCents?: string;
  incompleteAmountCount: number;
  incompleteDueDateCount: number;
};

export type PlatformBillingReceivablePage = {
  items: PlatformBillingReceivable[];
  summary: PlatformBillingReceivableSummary;
  nextCursor?: string;
};

export type PlatformBillingReceivablesReadAudit = {
  actorOperatorId: string;
  environment: string;
  correlationId: string;
  returnedItems: number;
  totalObservedReceivables: number;
  status?: PlatformBillingReceivableStatus;
};

export interface PlatformBillingReceivableRepository {
  list(input: PlatformBillingReceivableQuery, asOf: Date): Promise<PlatformBillingReceivablePage>;
  summary(asOf: Date): Promise<PlatformBillingReceivableSummary>;
  recordRead(input: PlatformBillingReceivablesReadAudit): Promise<void>;
}
