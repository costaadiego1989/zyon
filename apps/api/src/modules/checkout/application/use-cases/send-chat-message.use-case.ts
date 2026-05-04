import { Inject, Injectable, NotFoundException, Optional } from "@nestjs/common";
import { evaluateDiscountOffer } from "@aacp/rules-engine";
import { evaluateShippingOffer } from "@aacp/shipping-engine";
import type {
  AuthorizedOffer,
  ChatMessageRequest,
  ChatMessageResponse,
  CheckoutSession,
  CustomerHints,
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
import {
  deriveChatStage,
  extractCep,
  extractCpf,
  extractEmail,
  extractName,
  extractPhone,
  missingFieldsForStage
} from "../../domain/services/customer-extraction.service.js";
import { buildExperienceFromSession } from "../services/checkout-experience.service.js";

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
    const merchant = await this.merchantRepo?.getProfile(input.merchant_id);

    const lastAgentTurn = [...session.chatHistory].reverse().find((t) => t.role === "agent")?.text;
    const customerPatch = this.buildCustomerPatch(input.user_message, session.customer, lastAgentTurn);
    const sessionWithCustomer: CheckoutSession = customerPatch
      ? await this.repository.saveSession({
          ...session,
          customer: { ...session.customer, ...customerPatch }
        })
      : session;

    const stage = deriveChatStage(sessionWithCustomer);
    const missingFields = missingFieldsForStage(sessionWithCustomer, stage);

    const offer = await this.authorizeOffer(input.user_message, sessionWithCustomer, rules);
    const agentContext = await this.agentContext?.get({
      merchantId: input.merchant_id,
      userId: input.agent_user_id,
      agentId: input.agent_id,
      globalUserId: sessionWithCustomer.globalUserId
    });

    const reply = await this.conversation.reply({
      userMessage: input.user_message,
      brandVoice: rules.brandVoice,
      authorizedOffer: offer,
      agentContext,
      merchantName: merchant?.name,
      cart: sessionWithCustomer.cart,
      history: sessionWithCustomer.chatHistory,
      stage,
      missingFields
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

    const experience = buildExperienceFromSession(updated, {
      merchantName: merchant?.name,
      theme: merchant?.theme,
      agent: agentContext,
      couponBoxEnabled: rules.couponBoxEnabled
    });

    return {
      message: reply.message,
      objection: reply.objection,
      authorized_offer: offer,
      actions: offer.approved
        ? [{ label: "Aplicar oferta", type: "apply_offer", offer_id: offer.id }]
        : [{ label: "Continuar checkout", type: "continue_checkout" }],
      turns: updated.chatHistory,
      experience,
      stage,
      missing_fields: missingFields
    };
  }

  private buildCustomerPatch(
    userMessage: string,
    existing: CustomerHints | undefined,
    lastAgentTurn: string | undefined
  ): Partial<CustomerHints> | null {
    const patch: Partial<CustomerHints> = {};
    if (!existing?.email) {
      const email = extractEmail(userMessage);
      if (email) patch.email = email.toLowerCase();
    }
    if (!existing?.cpf) {
      const cpf = extractCpf(userMessage);
      if (cpf) patch.cpf = cpf;
    }
    if (!existing?.phone) {
      const phone = extractPhone(userMessage);
      if (phone) patch.phone = phone;
    }
    if (!existing?.address?.zip) {
      const zip = extractCep(userMessage);
      if (zip) {
        patch.address = { ...(existing?.address ?? {}), zip };
      }
    }
    if (!existing?.fullName) {
      const name = extractName(userMessage, lastAgentTurn);
      if (name) patch.fullName = name;
    }
    return Object.keys(patch).length === 0 ? null : patch;
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
