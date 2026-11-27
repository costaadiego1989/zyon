/**
 * WhatsApp Sender Port — outbound message interface.
 * Infrastructure adapters implement this to send messages via BubbleWhats or other providers.
 */

export const WHATSAPP_SENDER_PORT = Symbol("WhatsAppSenderPort");

export interface WhatsAppOutboundMessage {
  provider?: string;
  correlationId?: string;
  toNumber: string;
  deviceId: string;
  text: string;
  mediaUrl?: string;
  mimetype?: string;
  uiMessage?: import("../ui/meta-ui.types.js").MetaUiMessage;
}

export interface WhatsAppSendResult {
  messageId: string;
  status: "sent" | "queued" | "failed" | "unknown";
}

export interface WhatsAppSenderPort {
  sendText(msg: WhatsAppOutboundMessage): Promise<WhatsAppSendResult>;
  sendMedia?(msg: WhatsAppOutboundMessage & { mediaUrl: string; mimetype: string }): Promise<WhatsAppSendResult>;
}

export interface StrictWhatsAppBinding { merchantId: string; configId: string; accountId: string; statusCallbackUrl?: string; credentialFingerprint?: string }
export interface StrictWhatsAppResult { messageId: string; status: "sent" | "uncertain" | "failed" | "skipped"; acceptance?: "not_accepted" }
export interface StrictWhatsAppSenderPort { sendTextStrict(message: WhatsAppOutboundMessage, binding: StrictWhatsAppBinding): Promise<StrictWhatsAppResult> }
