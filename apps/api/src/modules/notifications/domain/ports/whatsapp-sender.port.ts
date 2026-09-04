export const WHATSAPP_SENDER_PORT = Symbol("WHATSAPP_SENDER_PORT");

export interface WhatsAppMessage {
  phone: string;
  message: string;
}

export interface WhatsAppSenderPort {
  send(msg: WhatsAppMessage): Promise<void>;
}
