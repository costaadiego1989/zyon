import type { WhatsAppChannelConfigEntity } from "../ports/whatsapp-config-repository.port.js";

export interface ConnectedTwilioCredentials { accountSid: string; authToken: string; senderId: string }
export function connectedTwilioCredentials(config: WhatsAppChannelConfigEntity | null | undefined, merchantId: string): ConnectedTwilioCredentials | null {
  if (!config || config.merchantId !== merchantId || config.enabled !== true || config.status !== "ACTIVE" || config.provider !== "TWILIO") return null;
  const c = config.credentials;
  const accountSid = typeof c.accountSid === "string" ? c.accountSid.trim() : "";
  const authToken = typeof c.authToken === "string" ? c.authToken.trim() : "";
  const senderId = typeof c.senderId === "string" ? c.senderId.trim() : "";
  const number = config.whatsappNumber?.replace(/\D/g, "");
  if (!accountSid || !authToken || !number || senderId !== `whatsapp:+${number}`) return null;
  if (c.onboardingVersion === 2 && c.senderStatus !== "ONLINE") return null;
  return { accountSid, authToken, senderId };
}
