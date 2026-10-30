/**
 * Order notification transport. Accepted means provider acceptance with an ID;
 * delivery is established separately by the authenticated provider receipts.
 */
export const NOTIFICATION_WHATSAPP_SENDER = Symbol("NOTIFICATION_WHATSAPP_SENDER");

export interface NotificationWhatsAppInput {
    merchantId: string;
    orderId: string;
    idempotencyKey?: string;
    type: "order_confirmation" | "order_nonphysical_confirmation" | "order_shipped" | "order_delivered" | "merchant_order_paid";
    toPhone?: string;
    variables?: Record<string, string | number | undefined>;
    freeformText?: string;
    fallbackEmail?: string;
    emailSubject?: string;
}

export type NotificationWhatsAppResult = {
  status: "accepted" | "skipped" | "failed" | "unknown";
  channel: "whatsapp_template" | "whatsapp_session" | "none";
  messageId?: string;
  reason?: string;
};

export interface NotificationWhatsAppSender {
  execute(input: NotificationWhatsAppInput): Promise<NotificationWhatsAppResult>;
}
