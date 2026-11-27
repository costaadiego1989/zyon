export const WHATSAPP_CONVERSATION_PORT = Symbol("WHATSAPP_CONVERSATION_PORT");
export interface WhatsAppConversationPort {
  /** Separate internal T46 dispatcher. The UI fence is not authentication:
   * implementation must verify the original current inbox/lease/sender and
   * canonical phone-owned checkout/buyer again. No embed origin/nonce is fabricated. */
  respondServiceBooking?(input: {
    verifiedSender: { inboxId: string; leaseToken: string; deviceId: string; fromNumber: string };
    merchantId: string; buyer: { globalUserId: string; phone: string; fullName?: string; email?: string };
    message: string; messageId?: string;
    state: import("../ui/meta-ui.types.js").WhatsAppConversationState;
    action: import("../ui/service-booking-controls.js").NativeServiceBookingAction;
  }): Promise<import("../ui/meta-ui.types.js").WhatsAppStructuredResponse>;
  respond(input: { merchantId: string; checkoutSessionId: string; message: string; requestId?: string;
    humanContext?: Array<{ role: "user" | "assistant"; content: string }> }): Promise<{
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
