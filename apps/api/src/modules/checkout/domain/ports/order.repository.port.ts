import type { CompletedOrder, CompletedOrderStatus } from "@zyon/shared-types";

export const ORDER_REPOSITORY = Symbol("ORDER_REPOSITORY");

export type MaybePromise<T> = T | Promise<T>;

export interface OrderRepository {
  /** Guard public completion within the same transaction as order/outbox writes. */
  assertPublicCompletionAllowed?(merchantId: string, sessionId: string): MaybePromise<void>;
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
