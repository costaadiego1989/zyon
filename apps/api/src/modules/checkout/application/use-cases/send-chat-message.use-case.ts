import { Inject, Injectable, NotFoundException, Optional } from "@nestjs/common";
import { evaluateDiscountOffer } from "@aacp/rules-engine";
import { evaluateShippingOffer } from "@aacp/shipping-engine";
import type {
  AuthorizedOffer,
  ChatMessageRequest,
  ChatMessageResponse,
  CheckoutSession,
  MerchantRules
} from "@aacp/shared-types";
import {
  CHECKOUT_REPOSITORY,
  type CheckoutRepository
} from "../../domain/ports/checkout-repository.port.js";
import { AGENT_CONTEXT_PORT, type AgentContextPort } from "../../domain/ports/agent-context.port.js";
import { CONVERSATION_PORT, type ConversationPort } from "../../domain/ports/conversation.port.js";
import {
  MERCHANT_REPOSITORY,
  type MerchantRepository
} from "../../../merchant/domain/ports/merchant-repository.port.js";
import { createAuthorizedOffer } from "./offer-factory.js";

@Injectable()
export class SendChatMessageUseCase {
  constructor(
    @Inject(CHECKOUT_REPOSITORY) private readonly repository: CheckoutRepository,
    @Inject(CONVERSATION_PORT) private readonly conversation: ConversationPort,
    @Optional() @Inject(AGENT_CONTEXT_PORT) private readonly agentContext?: AgentContextPort,
    @Optional() @Inject(MERCHANT_REPOSITORY) private readonly merchantRepo?: MerchantRepository
  ) {}

  async execute(input: ChatMessageRequest): Promise<ChatMessageResponse> {
    const session = await this.repository.getSession(input.merchant_id, input.session_id);
    if (!session) throw new NotFoundException("checkout_session_not_found");
    const rules = await this.repository.getRules(input.merchant_id);
    const offer = await this.authorizeOffer(input.user_message, session, rules);
    const agentContext = await this.agentContext?.get({
      merchantId: input.merchant_id,
      userId: input.agent_user_id,
      agentId: input.agent_id,
      globalUserId: session.globalUserId
    });
    const merchant = await this.merchantRepo?.getProfile(input.merchant_id);

    const reply = await this.conversation.reply({
      userMessage: input.user_message,
      brandVoice: rules.brandVoice,
      authorizedOffer: offer,
      agentContext,
      merchantName: merchant?.name,
      cart: session.cart,
      history: session.chatHistory
    });

    const now = new Date().toISOString();
    await this.repository.appendChatTurn(input.merchant_id, input.session_id, {
      role: "buyer",
      text: input.user_message,
      occurredAt: now
    });
    const updated = await this.repository.appendChatTurn(input.merchant_id, input.session_id, {
      role: "agent",
      text: reply.message,
      occurredAt: new Date().toISOString(),
      authorizedOfferId: offer.approved ? offer.id : undefined
    });

    return {
      message: reply.message,
      objection: reply.objection,
      authorized_offer: offer,
      actions: offer.approved
        ? [{ label: "Aplicar oferta", type: "apply_offer", offer_id: offer.id }]
        : [{ label: "Continuar checkout", type: "continue_checkout" }],
      turns: updated.chatHistory
    };
  }

  private async authorizeOffer(
    userMessage: string,
    session: CheckoutSession,
    rules: MerchantRules
  ): Promise<AuthorizedOffer> {
    const wantsShipping = /(frete|envio|shipping)/.test(userMessage.toLowerCase());
    const evaluation = wantsShipping
      ? evaluateShippingOffer({
          cart: session.cart,
          shipping: session.shipping,
          rules,
          abandonmentScore: Math.max(session.abandonmentScore, 0.7)
        })
      : evaluateDiscountOffer(session.cart, rules, rules.maxDiscountPercent);
    const offer = createAuthorizedOffer({
      merchantId: session.merchantId,
      sessionId: session.sessionId,
      rules,
      evaluation
    });
    return this.repository.saveOffer(offer);
  }
}
