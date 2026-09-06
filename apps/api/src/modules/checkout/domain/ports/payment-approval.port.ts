import type { PaymentAmountBreakdown } from "../../../payment/domain/payment-amount.js";

export const PAYMENT_APPROVAL_READER = Symbol("PAYMENT_APPROVAL_READER");

export interface PersistedPaymentApproval {
  id: string;
  merchantId: string;
  sessionId: string;
  status: string;
  currency: string;
  amountCents: number;
  approvedAmountCents: number | null;
  providerPaymentId: string | null;
  acceptedOfferId: string | null;
  amountBreakdown: PaymentAmountBreakdown | null;
}

export interface PaymentApprovalReader {
  find(merchantId: string, sessionId: string, paymentIntentId: string): Promise<PersistedPaymentApproval | null>;
}
