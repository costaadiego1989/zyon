import type { WhatsAppChannelConfigEntity } from "../../../whatsapp-channel/domain/ports/whatsapp-config-repository.port.js";
import type { WhatsAppTemplateRecord } from "../ports/whatsapp-template-repository.port.js";

export interface ConnectedTwilioCredentials {
  accountSid: string;
  authToken: string;
  senderId: string;
}

/** Preserve explicit international country codes; infer Brazil only for its national formats. */
export function normalizeRecoveryRecipient(raw: string): string | null {
  const value = raw.trim();
  if (!/^\+?[\d\s().-]+$/.test(value)) return null;
  const digits = value.replace(/\D/g, "");
  if (value.startsWith("+")) return /^[1-9]\d{7,14}$/.test(digits) ? `+${digits}` : null;

  const brazilianNational = /^[1-9]\d(?:[2-5]\d{7}|9\d{8})$/;
  if (brazilianNational.test(digits)) return `+55${digits}`;
  if (digits.startsWith("55") && brazilianNational.test(digits.slice(2))) return `+${digits}`;
  return null;
}

/** Only the merchant connection can authorize recovery; environment credentials cannot. */
export function connectedTwilioCredentials(
  config: WhatsAppChannelConfigEntity | null | undefined,
  merchantId: string,
): ConnectedTwilioCredentials | null {
  if (!config || config.merchantId !== merchantId || config.enabled !== true
      || config.status !== "ACTIVE" || config.provider !== "TWILIO") return null;

  const credentials = config.credentials ?? {};
  const accountSid = typeof credentials.accountSid === "string" ? credentials.accountSid.trim() : "";
  const authToken = typeof credentials.authToken === "string" ? credentials.authToken.trim() : "";
  const senderId = typeof credentials.senderId === "string" ? credentials.senderId.trim() : "";
  const connectedNumber = config.whatsappNumber?.replace(/\D/g, "");
  if (!accountSid || !authToken || !connectedNumber || senderId !== `whatsapp:+${connectedNumber}`) return null;
  return { accountSid, authToken, senderId };
}

export function isApprovedRecoveryTemplate(
  template: WhatsAppTemplateRecord | null | undefined,
  merchantId: string,
  contentSid?: string,
): template is WhatsAppTemplateRecord & { twilioContentSid: string } {
  return !!template && template.merchantId === merchantId && template.type === "cart_recovery"
    && template.channel === "whatsapp" && template.isActive === true && template.metaStatus === "approved"
    && typeof template.twilioContentSid === "string" && template.twilioContentSid.trim().length > 0
    && (template.metaRevision === undefined || !!template.metaLastCheckedAt
      && template.metaLastCheckedAt.getTime() <= Date.now()
      && Date.now() - template.metaLastCheckedAt.getTime() < 15 * 60_000)
    && (contentSid === undefined || template.twilioContentSid === contentSid);
}
