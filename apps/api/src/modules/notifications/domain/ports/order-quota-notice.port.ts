export const ORDER_QUOTA_NOTICE_REPOSITORY = Symbol("OrderQuotaNoticeRepository");
export const ORDER_QUOTA_NOTICE_SENDER = Symbol("OrderQuotaNoticeSender");
export const ORDER_QUOTA_NOTICE_VALIDITY = Symbol("OrderQuotaNoticeValidity");
export const ORDER_QUOTA_DELIVERY_LEASE_MS = 60_000;

export interface OrderQuotaNotice {
  id: string;
  merchantId: string;
  periodStart: Date;
  episodeKey: string;
  milestone: string;
  title: string;
  body: string | null;
  metadata: unknown;
  createdAt: Date;
}

export type QuotaDeliveryStatus = "accepted" | "delivered" | "retryable_failed" | "unknown" | "skipped" | "failed";
export interface QuotaDeliveryResult {
  status: QuotaDeliveryStatus;
  reason?: string;
  providerMessageId?: string;
}
export interface QuotaDeliveryClaim {
  id: string;
  channel: string;
  attempts: number;
  leaseUntil: Date;
  notice: OrderQuotaNotice;
}
export interface OrderQuotaNoticeRepository {
  expireSending(now: Date): Promise<number>;
  claimNext(now: Date): Promise<QuotaDeliveryClaim | null>;
  beginSending(claim: QuotaDeliveryClaim, now: Date): Promise<boolean>;
  finish(claim: QuotaDeliveryClaim, result: QuotaDeliveryResult, now: Date, nextAttemptAt?: Date): Promise<boolean>;
}

/** Must consult the current deterministic quota state, including period/episode and deadline. */
export interface OrderQuotaNoticeValidity {
  isCurrent(notice: OrderQuotaNotice, now: Date): Promise<boolean>;
}
export type PreparedQuotaDelivery = QuotaDeliveryResult | { send(): Promise<QuotaDeliveryResult> };
export interface OrderQuotaNoticeSender {
  /** Preparation must have no external message dispatch. */
  prepare(notice: OrderQuotaNotice, channel: string): Promise<PreparedQuotaDelivery>;
}
