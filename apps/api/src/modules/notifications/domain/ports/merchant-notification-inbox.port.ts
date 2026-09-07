export const MERCHANT_NOTIFICATION_INBOX_PORT = Symbol("MERCHANT_NOTIFICATION_INBOX_PORT");

export interface MerchantNotificationInboxPort {
  list(merchantId: string, since?: Date): Promise<unknown[]>;
  markRead(merchantId: string, notificationId: string): Promise<void>;
  markAllRead(merchantId: string): Promise<void>;
}
