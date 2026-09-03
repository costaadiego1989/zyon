/**
 * Port for business-initiated WhatsApp messages using Meta-approved templates.
 *
 * This is the ONLY safe channel for pós-venda messages outside the 24-hour
 * customer-service window (review D+3, NPS D+7, win-back D+30, etc.).
 *
 * BubbleWhats (informal) MUST NOT be used for these messages — Meta bans the
 * number for unsolicited business-initiated text outside the session window.
 */
export const POST_SALE_WHATSAPP_SENDER = Symbol("PostSaleWhatsAppSender");

export interface PostSaleTemplateSendInput {
  /** Resolved merchant id for credential lookup. */
  merchantId: string;
  /** E.164 recipient phone, e.g. "5511999998888". Leading country code optional. */
  toNumber: string;
  /** Twilio Content Template SID (e.g. "HXabc123…") for this approved template. */
  contentSid: string;
  /** Positional variable substitutions matching the approved template body.
   *  Key = position string ("1", "2", …), value = runtime value. */
  contentVariables: Record<string, string>;
}

export interface PostSaleTemplateSendResult {
  messageId: string;
  status: "sent" | "queued" | "failed" | "skipped";
  /** Reason when status is skipped/failed and the caller should not retry. */
  reason?: string;
}

export interface PostSaleWhatsAppSenderPort {
  sendTemplate(input: PostSaleTemplateSendInput): Promise<PostSaleTemplateSendResult>;
}
