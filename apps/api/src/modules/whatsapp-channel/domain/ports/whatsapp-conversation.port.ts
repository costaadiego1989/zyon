export const WHATSAPP_CONVERSATION_PORT = Symbol("WHATSAPP_CONVERSATION_PORT");
export interface WhatsAppConversationPort {
  respond(input: { merchantId: string; checkoutSessionId: string; message: string }): Promise<{
    agentMessage: string; quickReplies: string[];
  }>;
  respondStore?(input: {
    verifiedSender?: { inboxId: string; leaseToken: string; deviceId: string; fromNumber: string };
    merchantId: string; buyer: { globalUserId: string; phone: string; fullName?: string; email?: string };
    message: string; state: import("../ui/meta-ui.types.js").WhatsAppConversationState;
    attachmentContext?: string;
    messageId?: string;
    action?: import("../ui/meta-ui.types.js").StoreUiAction;
  }): Promise<import("../ui/meta-ui.types.js").WhatsAppStructuredResponse>;
}
