/**
 * Twilio Webhook Parser — normalizes Twilio form-encoded inbound messages.
 *
 * Twilio sends form-encoded POST body with:
 * - From: whatsapp:+5521993001883
 * - To: whatsapp:+5521989825798
 * - Body: message text
 * - MessageSid: unique message identifier
 * - WaId: buyer's WhatsApp ID (without whatsapp: prefix)
 * - ProfileName: buyer's display name
 */

export interface TwilioInboundWebhook {
  MessageSid: string;
  From: string; // "whatsapp:+5521993001883"
  To: string; // "whatsapp:+5521989825798"
  Body?: string;
  WaId: string; // "5521993001883"
  ProfileName?: string;
  NumMedia?: string;
  MediaUrl0?: string;
  MediaContentType0?: string;
}

export interface NormalizedInboundMessage {
  messageSid: string; // for idempotency dedup
  fromNumber: string; // +5521993001883
  toNumber: string; // +5521989825798 (used to lookup merchant by number)
  body: string;
  waId: string; // buyer's WhatsApp ID
  fromAlias?: string; // buyer's display name
  mediaUrl?: string;
  mimetype?: string;
  timestamp: number; // unix ms for consistency with BubbleWhats
}

/**
 * Parse Twilio form-encoded webhook body into normalized message.
 */
export function parseTwilioInbound(body: Record<string, string>): NormalizedInboundMessage | null {
  const messageSid = body.MessageSid;
  const from = body.From; // "whatsapp:+5521993001883"
  const to = body.To; // "whatsapp:+5521989825798"
  const text = body.Body ?? "";
  const waId = body.WaId;
  const profileName = body.ProfileName;

  if (!messageSid || !from || !to || !waId) {
    return null;
  }

  // Extract numbers from whatsapp: URIs
  const fromMatch = from.match(/\+?(\d+)$/);
  const toMatch = to.match(/\+?(\d+)$/);

  if (!fromMatch || !toMatch) {
    return null;
  }

  const fromNumber = fromMatch[1];
  const toNumber = toMatch[1];

  const mediaUrl = body.MediaUrl0;
  const mimetype = body.MediaContentType0;

  return {
    messageSid,
    fromNumber: `+${fromNumber}`,
    toNumber: `+${toNumber}`,
    body: text,
    waId,
    fromAlias: profileName,
    mediaUrl,
    mimetype,
    timestamp: Date.now(),
  };
}
