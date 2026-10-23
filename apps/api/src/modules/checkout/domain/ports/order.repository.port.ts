import type { CompletedOrder, CompletedOrderStatus } from "@zyon/shared-types";
import type { CheckoutCouponOrderAuthority } from "../services/checkout-coupon-binding.js";
import type { WidgetCheckoutPaymentAuthority } from "../../../payment/domain/widget-checkout-payment-authority.schemas.js";

export const ORDER_REPOSITORY = Symbol("ORDER_REPOSITORY");

export type MaybePromise<T> = T | Promise<T>;

export interface OrderRepository {
  /** Guard public completion within the same transaction as order/outbox writes. */
  assertPublicCompletionAllowed?(merchantId: string, sessionId: string): MaybePromise<void>;
  /** Internal order/outbox transaction recheck, not a public authority input. */
  assertCouponOrderAuthority?(merchantId: string, sessionId: string, authority?: CheckoutCouponOrderAuthority, paymentIntentId?: string): MaybePromise<void>;
  /** Actual approved journal recheck in SAME transaction as order/outbox writes. */
  assertWidgetPaymentOrderAuthority?(merchantId: string, sessionId: string, authority: WidgetCheckoutPaymentAuthority,
    paymentIntentId: string, providerPaymentId: string): MaybePromise<void>;
  saveCompletedOrder(order: CompletedOrder): MaybePromise<{ order: CompletedOrder; idempotent: boolean }>;
  getCompletedOrder(merchantId: string, sessionId: string, externalOrderId: string): MaybePromise<CompletedOrder | undefined>;
  findCompletedOrderByExternalOrderId(merchantId: string, externalOrderId: string): MaybePromise<CompletedOrder | undefined>;
  findCompletedOrderById?(merchantId: string, orderId: string): MaybePromise<CompletedOrder | undefined>;
  updateCompletedOrderTracking(input: {
    merchantId: string;
    sessionId: string;
    externalOrderId: string;
    trackingCode: string;
  }): MaybePromise<CompletedOrder | undefined>;
  updateCompletedOrderStatus(input: {
    merchantId: string;
    sessionId: string;
    externalOrderId: string;
    status: CompletedOrderStatus;
  }): MaybePromise<CompletedOrder | undefined>;
  cancelCompletedOrder(input: {
    merchantId: string;
    sessionId: string;
    externalOrderId: string;
    reason: string;
    cancelledAt: string;
  }): MaybePromise<{ order: CompletedOrder; idempotent: boolean } | undefined>;
}
