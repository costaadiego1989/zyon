import type { OrderConfirmationEvent } from "../../domain/events/notification.events.js";

export const PAID_ORDER_RECEIPT_READER = Symbol("PAID_ORDER_RECEIPT_READER");
export interface PaidOrderReceiptReader {
  read(input: { merchantId: string; externalOrderId: string }): Promise<OrderConfirmationEvent | null>;
}
export type OrderReceiptDeliveryOptions = { idempotencyPurpose?: string; skipDashboard?: boolean };
