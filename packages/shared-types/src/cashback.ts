/** Monetary amounts are integer BRL cents; rates are integer basis points. */
export interface CashbackCombinationRules {
  allowCoupons: boolean;
  allowAdvancedRules: boolean;
  limitMode: "respect_general" | "cashback_specific";
  maximumCombinedDiscountBps: number | null;
  maximumCombinedDiscountCents: number | null;
}

export interface CashbackRules {
  earnRateBps: number;
  minimumEarnCents: number;
  maximumEarnPerOrderCents: number | null;
  buyerMonthlyEarnLimitCents: number | null;
  monthlyBudgetCents: number | null;
  releaseTrigger: "payment_confirmed" | "order_fulfilled";
  releaseDelayDays: number;
  expiryDays: number | null;
  minimumRedeemOrderCents: number;
  maximumRedeemBps: number;
  maximumRedeemCents: number | null;
  allowWithDiscounts: boolean;
  /** Legacy snapshots omit this. New merchant publication requires explicit choices. */
  combination?: CashbackCombinationRules;
  terms: string;
}

/** Drafts retain only explicit choices, including incomplete combination rules. */
export type CashbackDraft = Omit<Partial<CashbackRules>, "combination"> & {
  combination?: Partial<CashbackCombinationRules>;
};

export interface CashbackProgramView {
  merchantId: string;
  status: "disabled" | "active" | "paused" | "ended";
  draft: CashbackDraft | null;
  published: CashbackRules | null;
  version: number;
  updatedAt: string | null;
  generalDiscountCapBps?: number | null;
  /** Opaque server revision of the configuration reviewed before a write. */
  configurationRevision?: string;
}

export interface CashbackConfigurationWrite {
  expectedRevision: string;
  idempotencyKey: string;
}

export interface CashbackBalance {
  pendingCents: number;
  availableCents: number;
  reservedCents: number;
  earnedCents: number;
  usedCents: number;
  expiredCents: number;
  reversedCents: number;
  lossCents: number;
  nextExpiryAt: string | null;
  nextExpiryCents: number;
}

export interface CashbackTransaction {
  id: string;
  merchantId: string;
  buyerId: string;
  type: "grant" | "release" | "reserve" | "unreserve" | "redeem" | "expire" | "reverse" | "restore" | "adjustment" | "loss";
  amountCents: number;
  orderId: string | null;
  sessionId: string | null;
  reason: string;
  actorId: string | null;
  occurredAt: string;
}

export interface CashbackWalletView {
  merchantId: string;
  buyerId: string;
  currency: "BRL";
  balance: CashbackBalance;
  program: Pick<CashbackProgramView, "status" | "version" | "published">;
}

export interface CashbackPage<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface CashbackCustomer {
  buyerId: string;
  displayName: string;
  email: string | null;
  balance: CashbackBalance;
  lastUsedAt: string | null;
  ordersWithCashback: number;
}

export interface CashbackDailyMovement {
  /** Business day in America/Sao_Paulo, formatted as YYYY-MM-DD. */
  date: string;
  grantedCents: number;
  redeemedCents: number;
}

export interface CashbackMetrics {
  from: string;
  to: string;
  asOf: string;
  grantedCents: number;
  releasedCents: number;
  redeemedCents: number;
  restoredCents: number;
  expiredCents: number;
  reversedCents: number;
  lossCents: number;
  pendingCents: number;
  availableCents: number;
  reservedCents: number;
  buyersGranted: number;
  buyersRedeemed: number;
  ordersWithCashback: number;
  associatedRevenueCents: number;
  budgetCommittedCents: number;
  budgetIssuedCents: number;
  budgetLimitCents: number | null;
  /** Absent only while reading an API version predating daily metrics. */
  dailyMovements?: CashbackDailyMovement[];
}

export interface CashbackCheckoutQuote {
  merchantId: string;
  sessionId: string;
  programActive: boolean;
  eligible: boolean;
  reason: string | null;
  availableCents: number;
  maximumRedeemCents: number;
  reservedCents: number;
  estimatedEarnCents: number;
  ruleVersion: number | null;
  fingerprint: string;
  terms: string | null;
}

/** Frozen by the server before invoking any external payment provider. */
export interface CashbackPaymentBinding {
  cashbackCents: number;
  reservationId: string | null;
  earningQuoteId: string | null;
}
