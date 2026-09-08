export const MERCHANT_NOTIFICATION_INBOX_PORT = Symbol("MERCHANT_NOTIFICATION_INBOX_PORT");

export interface CreateMerchantNotificationInput {
  merchantId: string;
  type: string;
  title: string;
  body?: string;
  metadata?: Record<string, unknown>;
}

export interface MerchantNotificationContact {
  merchantId: string;
  merchantName: string;
  ownerEmail?: string;
  supportEmail?: string;
  whatsappPhone?: string;
  whatsappConnected: boolean;
}

export interface MerchantNotificationInboxPort {
  list(merchantId: string, since?: Date): Promise<unknown[]>;
  create(input: CreateMerchantNotificationInput): Promise<unknown>;
  getContact(merchantId: string): Promise<MerchantNotificationContact | null>;
  markRead(merchantId: string, notificationId: string): Promise<void>;
  markAllRead(merchantId: string): Promise<void>;
}
