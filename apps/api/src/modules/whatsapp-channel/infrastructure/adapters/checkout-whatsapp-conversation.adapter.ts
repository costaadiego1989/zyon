import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import { SendChatMessageUseCase } from "../../../checkout/application/use-cases/send-chat-message.use-case.js";
import { CHECKOUT_SESSION_REPOSITORY, type CheckoutSessionRepository } from "../../../checkout/domain/ports/checkout-session.repository.port.js";
import type { WhatsAppConversationPort } from "../../domain/ports/whatsapp-conversation.port.js";

@Injectable()
export class CheckoutWhatsAppConversationAdapter implements WhatsAppConversationPort {
  constructor(
    private readonly chat: SendChatMessageUseCase,
    @Inject(CHECKOUT_SESSION_REPOSITORY) private readonly sessions: CheckoutSessionRepository,
  ) {}

  async respond(input: { merchantId: string; checkoutSessionId: string; message: string }) {
    const session = await this.sessions.getSession(input.merchantId, input.checkoutSessionId);
    if (!session || session.merchantId !== input.merchantId) throw new NotFoundException("checkout_session_not_found");
    const response = await this.chat.execute({
      merchant_id: input.merchantId,
      session_id: session.sessionId,
      conversation_id: session.conversationId,
      user_message: input.message,
    });
    const parts = [response.message];
    const experience = response.experience;
    for (const product of experience?.suggestedProducts ?? []) {
      parts.push(product.name + " — " + product.unit_price.toLocaleString("pt-BR", { style: "currency", currency: "BRL" }));
    }
    const payment = experience?.payment_intent;
    if (payment && ["pending", "created", "requires_action"].includes(payment.status)) {
      if (payment.copy_paste) parts.push("PIX copia e cola:\n" + payment.copy_paste);
      if (payment.ticket_url) parts.push("Link de pagamento: " + payment.ticket_url);
    }
    return {
      agentMessage: parts.filter(Boolean).join("\n\n"),
      quickReplies: [...new Set([...(experience?.copy.quick_replies ?? []), ...response.actions.map(action => action.label)])].slice(0, 9),
    };
  }
}
