/**
 * WhatsApp Channel Config Repository Port — device-to-merchant mapping.
 */

export const WHATSAPP_CONFIG_REPOSITORY = Symbol("WhatsAppConfigRepository");

export interface WhatsAppChannelConfigEntity {
  id: string;
  merchantId: string;
  enabled: boolean;
  deviceId: string;
  phoneNumber: string;
  webhookSecret: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface WhatsAppConfigRepository {
  findByDeviceId(deviceId: string): Promise<WhatsAppChannelConfigEntity | null>;
  findByMerchantId(merchantId: string): Promise<WhatsAppChannelConfigEntity | null>;
  upsert(merchantId: string, data: Partial<Omit<WhatsAppChannelConfigEntity, "id" | "merchantId" | "createdAt">>): Promise<WhatsAppChannelConfigEntity>;
}
