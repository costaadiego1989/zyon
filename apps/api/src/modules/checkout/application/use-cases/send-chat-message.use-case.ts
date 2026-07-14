import { Inject, Injectable, NotFoundException, Optional } from "@nestjs/common";
import type {
  ChatMessageRequest,
  ChatMessageResponse,
  SuggestedProduct
} from "@zyon/shared-types";
import { DEFAULT_MERCHANT_RULES } from "@zyon/shared-types";
import { CHECKOUT_SESSION_REPOSITORY, type CheckoutSessionRepository } from "../../domain/ports/checkout-session.repository.port.js";
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
import { ListEligibleCrossSellsUseCase } from "../../../cross-sell/application/use-cases/list-eligible-cross-sells.use-case.js";
import { resolveCrossSellProduct } from "../../../cross-sell/application/services/cross-sell-product-resolver.js";
import { TenantBoundaryGuard } from "../../infrastructure/tenant-boundary.guard.js";
import { isSafeGeneratedMessage } from "../../domain/types/safe-generated-message.js";

function structuredCloneDeep<T>(obj: T): T {
  if (typeof globalThis.structuredClone === "function") return globalThis.structuredClone(obj);
  return JSON.parse(JSON.stringify(obj)) as T;
}

@Injectable()
export class SendChatMessageUseCase {
  constructor(
    @Inject(CHECKOUT_SESSION_REPOSITORY) private readonly sessions: CheckoutSessionRepository,
    @Inject(CONVERSATION_PORT) private readonly conversation: ConversationPort,
    private readonly customerService: CheckoutCustomerService,
    private readonly shippingService: CheckoutShippingService,
    private readonly offerService: CheckoutOfferService,
    @Optional() @Inject(AGENT_CONTEXT_PORT) private readonly agentContext?: AgentContextPort,
    @Optional() @Inject(MERCHANT_REPOSITORY) private readonly merchantRepo?: MerchantRepository,
    @Optional() private readonly crossSellUseCase?: ListEligibleCrossSellsUseCase
  ) {}

  async execute(input: ChatMessageRequest): Promise<ChatMessageResponse> {
    const session = await this.sessions.getSession(input.merchant_id, input.session_id);
    if (!session) throw new NotFoundException("checkout_session_not_found");
    const rules = await this.merchantRepo?.getRules(input.merchant_id) ?? DEFAULT_MERCHANT_RULES;
    const merchant = await this.merchantRepo?.getProfile(input.merchant_id);

    const lastAgentTurn = [...session.chatHistory].reverse().find((t) => t.role === "agent")?.text;
    const previousStage = deriveChatStage(session);
    let working = structuredCloneDeep(session);

    try {
      working = await this.customerService.processCustomerInput(
        working,
        input.user_message,
        lastAgentTurn,
        merchant?.name
      );
    } catch (error: any) {
      if (error.name === "OtpValidationError") {
        const errorMsg = error.message;

        const now = new Date().toISOString();
        await this.sessions.appendChatTurn(input.merchant_id, input.session_id, {
          role: "buyer",
          text: input.user_message,
          occurredAt: now
        });
        const updated = await this.sessions.appendChatTurn(input.merchant_id, input.session_id, {
          role: "agent",
          text: errorMsg,
          occurredAt: new Date().toISOString()
        });

        const experience = buildExperienceFromSession(updated, {
          merchantName: merchant?.name,
          theme: merchant?.theme,
          couponBoxEnabled: rules.couponBoxEnabled,
          rules
        });

        // Override quick replies and missing_fields for OTP errors so composer shows correct state
        const isPhoneOtp = Boolean(updated.customer?.phone_otp_code && !updated.customer?.phone_verified);
        const otpMissingField = isPhoneOtp ? "código de verificação do celular" : "código de verificação";
        const otpQuickReplies = isPhoneOtp
          ? ["Reenviar código SMS", "Não recebi o SMS", "Posso usar outro número?"]
          : ["Reenviar código de e-mail", "Não recebi o código", "Qual e-mail foi usado?"];
        const responseExperience = {
          ...experience,
          copy: { ...experience.copy, quick_replies: otpQuickReplies }
        };

        return {
          message: errorMsg,
          objection: "unknown",
          actions: [],
          turns: updated.chatHistory,
          experience: responseExperience,
          stage: "data_collection",
          missing_fields: [otpMissingField]
        };
      }
      throw error;
    }

    working = await this.shippingService.processShippingState(working, input.user_message);

    const stage = deriveChatStage(working);
    const missingFields = missingFieldsForStage(working, stage);

    const offer = await this.offerService.authorizeOffer(input.user_message, working, rules, stage, missingFields);

    // Tenant boundary: ensure agent context is scoped to the correct merchant.
    // The port is scoped by merchantId in the request, but we verify the session matches.
    TenantBoundaryGuard.assert.merchantIdMatches(
      working.merchantId,
      input.merchant_id,
      "agent context lookup"
    );
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
      deliverySummary: this.shippingService.summarizeDelivery(working),
      shippingOptions: working.shippingOptions
    });

    // INVARIANT: Validate generated message does not contain unauthorized offer claims.
    // The conversation port generates copy only; it must never claim to authorize discounts.
    const safetyCheck = isSafeGeneratedMessage(reply.message);
    const safeMessage = safetyCheck.safe
      ? reply.message
      : "Como posso ajudar com o seu pedido?";

    const now = new Date().toISOString();
    await this.sessions.appendChatTurn(input.merchant_id, input.session_id, {
      role: "buyer",
      text: input.user_message,
      occurredAt: now
    });
    const updated = await this.sessions.appendChatTurn(input.merchant_id, input.session_id, {
      role: "agent",
      text: safeMessage,
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
    let suggestedProducts: SuggestedProduct[] = [];

    if (stage === "payment" && previousStage === "shipping" && this.crossSellUseCase) {
      try {
        const suggestions = await this.crossSellUseCase.execute({
          session_id: input.session_id,
          merchant_id: input.merchant_id,
          cart: working.cart
        });
        suggestedProducts = suggestions.flatMap((suggestion) =>
          suggestion.ranked_items.map((sku) => resolveCrossSellProduct(sku, suggestion.id))
        );
      } catch {
        // cross-sell is non-critical; swallow errors
      }
    }

    const responseExperience = suggestedProducts.length > 0
      ? {
        ...experience,
        suggestedProducts
      }
      : experience;

    if (wantsPix) {
      chatActions.push({ label: "Gerar PIX", type: "continue_checkout" });
    } else if (wantsCard) {
      chatActions.push({ label: "Pagar com Cartão", type: "continue_checkout" });
    } else if (offer.approved && stage === "payment") {
      const alreadyHasDiscount = offer.type.includes("discount") && working.cart.currentDiscount && working.cart.currentDiscount > 0;
      const alreadyHasFreeShipping = offer.type.includes("shipping") && working.shipping?.customerPrice === 0;
      if (!alreadyHasDiscount && !alreadyHasFreeShipping) {
        chatActions.push({ label: "Aplicar oferta", type: "apply_offer", offer_id: offer.id });
      }
    }

    // Convert SafeAuthorizedOffer back to plain AuthorizedOffer for the response contract.
    // The type barrier ensured authorization came from rules-engine/shipping-engine only.
    const authorizedOfferResponse = offer.toAuthorizedOffer();

    return {
      message: safeMessage,
      objection: reply.objection,
      authorized_offer: authorizedOfferResponse,
      actions: chatActions,
      turns: updated.chatHistory,
      experience: responseExperience,
      stage,
      missing_fields: missingFields
    };
  }
}
