/**
 * Port for business-initiated WhatsApp messages using Meta-approved templates
 * (Twilio Content). The ONLY safe channel outside the 24h session window.
 *
 * BubbleWhats (informal) MUST NOT be used here — Meta bans the number for
 * unsolicited business-initiated text outside the session window.
 */
export const WHATSAPP_TEMPLATE_SENDER = Symbol("WhatsAppTemplateSender");

export interface TemplateSendInput {
  merchantId: string;
  /** E.164 recipient phone; leading country code optional (55 prefix added). */
  toNumber: string;
  /** Twilio Content Template SID (e.g. "HXabc123…"). */
  contentSid: string;
  /** position → value ("1" → "Ana"). */
  contentVariables: Record<string, string>;
}

export interface TemplateSendResult {
  messageId: string;
  status: "sent" | "queued" | "failed" | "skipped";
  reason?: string;
}

export interface WhatsAppTemplateSenderPort {
  sendTemplate(input: TemplateSendInput): Promise<TemplateSendResult>;
}
