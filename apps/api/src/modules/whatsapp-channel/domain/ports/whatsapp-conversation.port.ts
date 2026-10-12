export const WHATSAPP_CONVERSATION_PORT = Symbol("WHATSAPP_CONVERSATION_PORT");
export interface WhatsAppConversationPort {
  respond(input: { merchantId: string; checkoutSessionId: string; message: string }): Promise<{
    agentMessage: string; quickReplies: string[];
  }>;
  respondStore?(input: {
    merchantId: string; buyer: { globalUserId: string; phone: string; fullName?: string; email?: string };
    message: string; state: import("../ui/meta-ui.types.js").WhatsAppConversationState;
    action?: import("../ui/meta-ui.types.js").StoreUiAction;
  }): Promise<import("../ui/meta-ui.types.js").WhatsAppStructuredResponse>;
}
