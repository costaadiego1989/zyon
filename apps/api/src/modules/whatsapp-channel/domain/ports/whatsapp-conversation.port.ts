export const WHATSAPP_CONVERSATION_PORT = Symbol("WHATSAPP_CONVERSATION_PORT");
export interface WhatsAppConversationPort {
  respond(input: { merchantId: string; checkoutSessionId: string; message: string }): Promise<{
    agentMessage: string; quickReplies: string[];
  }>;
}
