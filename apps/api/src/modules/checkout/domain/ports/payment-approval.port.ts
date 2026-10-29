import type { PaymentAmountBreakdown } from "../../../payment/domain/payment-amount.js";
import type { CheckoutCouponPaymentAuthority } from "../services/checkout-coupon-binding.js";
import type { WidgetCheckoutPaymentAuthority } from "../../../payment/domain/widget-checkout-payment-authority.schemas.js";
import type { NormalCheckoutPaymentAuthority } from "../../../payment/domain/normal-checkout-payment-authority.schemas.js";

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
  /** Internal persisted snapshot only; never accepted from a completion body. */
  couponAuthority?: CheckoutCouponPaymentAuthority;
  /** Internal immutable admitted journal. Never accepted from completion input. */
  widgetCheckoutAuthority?: WidgetCheckoutPaymentAuthority;
  normalCrossSellAuthority?: NormalCheckoutPaymentAuthority;
}

export interface PaymentApprovalReader {
  find(merchantId: string, sessionId: string, paymentIntentId: string): Promise<PersistedPaymentApproval | null>;
}
