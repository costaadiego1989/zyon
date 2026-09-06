export const WHATSAPP_SENDER_PORT = Symbol("WHATSAPP_SENDER_PORT");

export interface WhatsAppMessage {
  phone: string;
  message: string;
}

export type WhatsAppSendResult =
  | { status: "accepted" }
  | { status: "skipped"; reason: "not_configured" | "missing_phone" };

export interface WhatsAppSenderPort {
  // Void remains compatible with legacy adapters, but is not evidence of acceptance.
  send(msg: WhatsAppMessage): Promise<WhatsAppSendResult | void>;
}
