/**
 * WhatsApp Channel Config Repository Port — device-to-merchant mapping.
 * Supports multi-provider: BubbleWhats (legacy deviceId-based) and Twilio (number-based).
 */

export const WHATSAPP_CONFIG_REPOSITORY = Symbol("WhatsAppConfigRepository");

export interface WhatsAppChannelConfigEntity {
  id: string;
  merchantId: string;
  enabled: boolean;
  provider: string; // BUBBLEWHATS | TWILIO | META_CLOUD
  credentials: Record<string, unknown>; // encrypted JSON
  whatsappNumber?: string; // E.164 format for webhook routing
  status: string; // DISCONNECTED | PENDING_VERIFICATION | ACTIVE | INACTIVE

  // Legacy BubbleWhats fields
  deviceId?: string;
  phoneNumber?: string;
  webhookSecret?: string;

  connectedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface WhatsAppConfigRepository {
  findById(id: string): Promise<WhatsAppChannelConfigEntity | null>;
  findByDeviceId(deviceId: string): Promise<WhatsAppChannelConfigEntity | null>;
  findByMerchantId(merchantId: string): Promise<WhatsAppChannelConfigEntity | null>;
  findByWhatsAppNumber(whatsappNumber: string): Promise<WhatsAppChannelConfigEntity | null>;
  findByMetaPhoneNumberId(phoneNumberId: string): Promise<WhatsAppChannelConfigEntity | null>;
  upsert(merchantId: string, data: Partial<Omit<WhatsAppChannelConfigEntity, "id" | "merchantId" | "createdAt">>): Promise<WhatsAppChannelConfigEntity>;
}
