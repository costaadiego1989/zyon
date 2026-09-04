/**
 * WhatsApp Sender Port — outbound message interface.
 * Infrastructure adapters implement this to send messages via BubbleWhats or other providers.
 */

export const WHATSAPP_SENDER_PORT = Symbol("WhatsAppSenderPort");

export interface WhatsAppOutboundMessage {
  toNumber: string;
  deviceId: string;
  text: string;
  mediaUrl?: string;
  mimetype?: string;
}

export interface WhatsAppSendResult {
  messageId: string;
  status: "sent" | "queued" | "failed";
}

export interface WhatsAppSenderPort {
  sendText(msg: WhatsAppOutboundMessage): Promise<WhatsAppSendResult>;
  sendMedia?(msg: WhatsAppOutboundMessage & { mediaUrl: string; mimetype: string }): Promise<WhatsAppSendResult>;
}
