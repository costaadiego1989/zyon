import type { QuotaDeliveryResult } from "./ports/order-quota-notice.port.js";

export const RETURN_NOTICE_TYPES = ["return_authorized", "return_approved", "return_rejected", "return_refunded", "exchange_completed"] as const;
export type ReturnNoticeType = typeof RETURN_NOTICE_TYPES[number];
export type ReturnNoticeResult = QuotaDeliveryResult | { status: "waiting_template" | "waiting_configuration"; reason: string };
export interface ReturnNoticePayload {
  orderId: string;
  kind: string;
  explanation: string;
  items: Array<{ name: string; quantity: number }>;
}
export interface ReturnNoticeClaim {
  id: string; merchantId: string; returnId: string; ticketId: string;
  type: ReturnNoticeType; channel: string; payload: ReturnNoticePayload;
  attempts: number; leaseUntil: Date; createdAt: Date;
}

