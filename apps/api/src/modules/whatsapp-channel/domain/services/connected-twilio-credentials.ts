import type { WhatsAppChannelConfigEntity } from "../ports/whatsapp-config-repository.port.js";
import { createHash } from "node:crypto";
import { canonicalJson } from "../../../../shared/http/canonical-json.js";
import { whatsappE164 } from "./whatsapp-phone.js";

/** Identity for an authenticated inbox, not outbound SDK eligibility. Legacy
 * HMAC intake supports token + configured To without an account SID. Include
 * the credential revision so old work cannot upgrade its connection later. */
export function twilioAuthorityAccountId(config: { provider: string; credentials: Record<string, unknown>; whatsappNumber?: string | null }): string | null {
  const c = config.credentials;
  if (config.provider !== "TWILIO" || !c || typeof c !== "object" || Array.isArray(c)
    || typeof c.authToken !== "string" || !c.authToken.trim()) return null;
  const sid = c.accountSid;
  if (sid !== undefined && (typeof sid !== "string" || !sid.trim())) return null;
  const number = config.whatsappNumber == null ? null : whatsappE164(config.whatsappNumber);
  if (config.whatsappNumber != null && !number || sid === undefined && !number) return null;
  const revision = createHash("sha256").update(canonicalJson({ credentials: c, number })).digest("hex");
  return sid === undefined ? `twilio:number:${number}:${revision}` : `twilio:account:${sid.trim()}:${revision}`;
}

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
