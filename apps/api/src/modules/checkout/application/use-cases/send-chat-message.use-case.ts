import { Inject, Injectable, NotFoundException, Optional } from "@nestjs/common";
import type {
  ChatMessageRequest,
  ChatMessageResponse
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
import {
  deriveChatStage,
  missingFieldsForStage
} from "../../domain/services/customer-extraction.service.js";
import { buildExperienceFromSession } from "../services/checkout-experience.service.js";
import { CheckoutCustomerService } from "../services/checkout-customer.service.js";
import { CheckoutShippingService } from "../services/checkout-shipping.service.js";
import { CheckoutOfferService } from "../services/checkout-offer.service.js";

function structuredCloneDeep<T>(obj: T): T {
  if (typeof globalThis.structuredClone === "function") return globalThis.structuredClone(obj);
  return JSON.parse(JSON.stringify(obj)) as T;
}

@Injectable()
export class SendChatMessageUseCase {
  constructor(
    @Inject(CHECKOUT_REPOSITORY) private readonly repository: CheckoutRepository,
    @Inject(CONVERSATION_PORT) private readonly conversation: ConversationPort,
    private readonly customerService: CheckoutCustomerService,
    private readonly shippingService: CheckoutShippingService,
    private readonly offerService: CheckoutOfferService,
    @Optional() @Inject(AGENT_CONTEXT_PORT) private readonly agentContext?: AgentContextPort,
    @Optional() @Inject(MERCHANT_REPOSITORY) private readonly merchantRepo?: MerchantRepository
  ) {}

  async execute(input: ChatMessageRequest): Promise<ChatMessageResponse> {
    const session = await this.repository.getSession(input.merchant_id, input.session_id);
    if (!session) throw new NotFoundException("checkout_session_not_found");
    const rules = await this.repository.getRules(input.merchant_id);
    const merchant = await this.merchantRepo?.getProfile(input.merchant_id);

    const lastAgentTurn = [...session.chatHistory].reverse().find((t) => t.role === "agent")?.text;
    let working = structuredCloneDeep(session);

    try {
      working = await this.customerService.processCustomerInput(
        working,
        input.user_message,
        lastAgentTurn,
        merchant?.name
      );
    } catch (error: any) {
      if (error.name === "EmailConflictError" || error.name === "OtpValidationError") {
        const errorMsg = error.name === "EmailConflictError"
          ? "Não é possível cadastrar com este e-mail. Este e-mail já está associado a outro cadastro em nossa loja. Por favor, informe um e-mail diferente."
          : error.message;

        const now = new Date().toISOString();
        await this.repository.appendChatTurn(input.merchant_id, input.session_id, {
          role: "buyer",
          text: input.user_message,
          occurredAt: now
        });
        const updated = await this.repository.appendChatTurn(input.merchant_id, input.session_id, {
          role: "agent",
          text: errorMsg,
          occurredAt: new Date().toISOString()
        });

        const currentStage = deriveChatStage(updated);
        const missingFields = missingFieldsForStage(updated, currentStage);
        const experience = buildExperienceFromSession(updated, {
          merchantName: merchant?.name,
          theme: merchant?.theme,
          couponBoxEnabled: rules.couponBoxEnabled,
          rules
        });

        return {
          message: errorMsg,
          objection: "unknown",
          actions: [],
          turns: updated.chatHistory,
          experience,
          stage: currentStage,
          missing_fields: missingFields
        };
      }
      throw error;
    }

    working = await this.shippingService.processShippingState(working, input.user_message);

    const stage = deriveChatStage(working);
    const missingFields = missingFieldsForStage(working, stage);

    const offer = await this.offerService.authorizeOffer(input.user_message, working, rules, stage, missingFields);
    
    const agentContext = await this.agentContext?.get({
      merchantId: input.merchant_id,
      userId: input.agent_user_id,
      agentId: input.agent_id,
      globalUserId: working.globalUserId
    });

    const reply = await this.conversation.reply({
      userMessage: input.user_message,
      brandVoice: rules.brandVoice,
      authorizedOffer: offer,
      agentContext,
      merchantName: merchant?.name,
      cart: working.cart,
      history: working.chatHistory,
      stage,
      missingFields,
      deliverySummary: this.shippingService.summarizeDelivery(working)
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
      couponBoxEnabled: rules.couponBoxEnabled,
      rules
    });

    const wantsPix = /\b(pix|qr code)\b/i.test(input.user_message) && stage === "payment";
    const wantsCard = /\b(cartão|cartao|credito|crédito)\b/i.test(input.user_message) && stage === "payment";
    const chatActions: any[] = [];

    if (wantsPix) {
      chatActions.push({ label: "Gerar PIX", type: "continue_checkout" });
    } else if (wantsCard) {
      chatActions.push({ label: "Pagar com Cartão", type: "continue_checkout" });
    } else if (offer.approved) {
      const alreadyHasDiscount = offer.type.includes("discount") && working.cart.currentDiscount && working.cart.currentDiscount > 0;
      const alreadyHasFreeShipping = offer.type.includes("shipping") && working.shipping?.customerPrice === 0;
      if (!alreadyHasDiscount && !alreadyHasFreeShipping) {
        chatActions.push({ label: "Aplicar oferta", type: "apply_offer", offer_id: offer.id });
      }
    }

    return {
      message: reply.message,
      objection: reply.objection,
      authorized_offer: offer,
      actions: chatActions,
      turns: updated.chatHistory,
      experience,
      stage,
      missing_fields: missingFields
    };
  }
}
