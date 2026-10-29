export const BILLING_ADMIN_NOTICE_PORT = Symbol("BILLING_ADMIN_NOTICE_PORT");
export interface PaidSubscriptionNotice {
  provider: "stripe"; subscriptionId: string; invoiceId: string; eventId: string;
  merchantId: string; planKey: "starter179" | "growth" | "scale"; billingCycle: "monthly" | "annual";
  amountPaidCents: number; discountCents: number; currency: string; occurredAt: string;
}
export interface BillingAdminNoticePort {
  enqueue(input: PaidSubscriptionNotice): Promise<void>;
}
