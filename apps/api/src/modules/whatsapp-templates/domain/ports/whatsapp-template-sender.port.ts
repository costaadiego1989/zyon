/**
 * Port for business-initiated WhatsApp messages using Meta-approved templates
 * (Cloud API). Templates are required outside the 24h session window.
 *
 * BubbleWhats (informal) MUST NOT be used here. Template approval does not
 * replace recipient permission or guarantee freedom from provider restrictions.
 */
export const WHATSAPP_TEMPLATE_SENDER = Symbol("WhatsAppTemplateSender");

export interface TemplateSendInput {
  merchantId: string;
  /** Recovery always revalidates the active merchant connection and approved template. */
  type?: "cart_recovery";
  /** Recovery preserves explicit +E.164; only valid Brazilian national numbers infer +55. */
  toNumber: string;
  /** Opaque approved provider template identifier. */
  contentSid: string;
  /** Meta template language, e.g. pt_BR. */
  language?: string;
  /** position → value ("1" → "Ana"). */
  contentVariables: Record<string, string>;
}

export interface TemplateSendResult {
  messageId: string;
  /** skipped guarantees no dispatch; uncertain must never trigger another channel or blind retry. */
  status: "sent" | "queued" | "failed" | "skipped" | "uncertain";
  /**
   * Only a documented synchronous provider rejection before message creation
   * may set this. A generic failure or missing messageId is not proof.
   * Recovery may use email only with status failed and no messageId.
   */
  acceptance?: "not_accepted";
  reason?: string;
}

export interface WhatsAppTemplateSenderPort {
  sendTemplate(input: TemplateSendInput): Promise<TemplateSendResult>;
}
