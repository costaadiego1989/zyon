import type { CompletedOrder } from "@aacp/shared-types";

export const ORDER_REPOSITORY = Symbol("ORDER_REPOSITORY");

export type MaybePromise<T> = T | Promise<T>;

export interface OrderRepository {
  saveCompletedOrder(order: CompletedOrder): MaybePromise<{ order: CompletedOrder; idempotent: boolean }>;
  getCompletedOrder(merchantId: string, sessionId: string, externalOrderId: string): MaybePromise<CompletedOrder | undefined>;
}
