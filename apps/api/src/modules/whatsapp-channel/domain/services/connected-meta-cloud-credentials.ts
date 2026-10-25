import type { WhatsAppChannelConfigEntity } from "../ports/whatsapp-config-repository.port.js";

export interface ConnectedMetaCloudCredentials {
  accessToken: string;
  wabaId: string;
  phoneNumberId: string;
}

/**
 * The only authority for a merchant's official WhatsApp connection. Provider
 * credentials are encrypted by the config repository before reaching storage.
 */
export function connectedMetaCloudCredentials(
  config: WhatsAppChannelConfigEntity | null | undefined,
  merchantId: string,
): ConnectedMetaCloudCredentials | null {
  if (!config || config.merchantId !== merchantId || config.enabled !== true
    || config.status !== "ACTIVE" || config.provider !== "META_CLOUD") return null;
  const credentials = config.credentials ?? {};
  const accessToken = typeof credentials.accessToken === "string" ? credentials.accessToken.trim() : "";
  const wabaId = typeof credentials.wabaId === "string" ? credentials.wabaId.trim() : "";
  const phoneNumberId = typeof credentials.phoneNumberId === "string" ? credentials.phoneNumberId.trim() : "";
  if (!accessToken || !/^\d{5,40}$/.test(wabaId) || !/^\d{5,40}$/.test(phoneNumberId)) return null;
  return { accessToken, wabaId, phoneNumberId };
}
