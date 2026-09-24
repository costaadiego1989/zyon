import { Inject, Injectable, Logger, Optional } from "@nestjs/common";
import type {
  ChatMessageResponse,
  CheckoutSession,
  MerchantRules,
  SuggestedProduct,
  ChatStage
} from "@zyon/shared-types";
import type { Objection } from "@zyon/conversation-engine";
import { CHECKOUT_SESSION_REPOSITORY, type CheckoutSessionRepository } from "../../domain/ports/checkout-session.repository.port.js";
import { CONVERSATION_PORT, type ConversationPort } from "../../domain/ports/conversation.port.js";
import { CHECKOUT_CROSS_SELL_RECOMMENDER, type CheckoutCrossSellRecommenderPort } from "../../domain/ports/cross-sell-recommender.port.js";
import { BUYER_CONVERSATION_REPOSITORY, type BuyerConversationRepository } from "../../../buyer-account/domain/ports/buyer-conversation.port.js";
import type { ProductRepositoryPort } from "../../../catalog/domain/ports/product-repository.port.js";
import { buildExperienceFromSession } from "./checkout-experience.service.js";
import { CHECKOUT_EXPERIENCE_CONFIG, type CheckoutExperienceConfig } from "../../domain/checkout-experience.config.js";
import { resolveCrossSellProduct } from "../../../cross-sell/application/services/cross-sell-product-resolver.js";
import { SafeAuthorizedOffer } from "../../domain/types/safe-authorized-offer.js";
import { CreatePaymentIntentUseCase } from "../../../payment/application/create-payment-intent.use-case.js";
import { DEFAULT_PLATFORM_FEE_BRL } from "../../../../shared/config/platform-fee.config.js";

export interface ChatReplyInput {
  reply: { message: string; objection: Objection; suggested_skus?: string[]; blocks?: Array<{ type: string; data?: Record<string, unknown> }> };
  safeMessage: string;
  userMessage: string;
  session: CheckoutSession;
  offer: SafeAuthorizedOffer;
  merchant: { id: string; name?: string } | undefined;
  rules: MerchantRules;
  stage: ChatStage;
  previousStage: ChatStage;
  missingFields: string[];
  isHoldout: boolean;
  preSearchedProducts: SuggestedProduct[];
  suppressPaymentActions?: boolean;
}

@Injectable()
export class ChatResponseBuilder {
  private readonly logger = new Logger(ChatResponseBuilder.name);

  constructor(
    @Inject(CHECKOUT_SESSION_REPOSITORY) private readonly sessions: CheckoutSessionRepository,
    @Optional() @Inject(CHECKOUT_CROSS_SELL_RECOMMENDER) private readonly crossSellRecommender?: CheckoutCrossSellRecommenderPort,
    // Kept in the constructor to preserve the existing Nest dependency shape.
    // Chat no longer creates payment intents; that is exclusively the signed
    // visual payment action in the embedded checkout.
    @Optional() private readonly _createPaymentIntent?: CreatePaymentIntentUseCase,
    @Optional() @Inject(BUYER_CONVERSATION_REPOSITORY) private readonly conversationRepo?: BuyerConversationRepository,
    @Inject(CHECKOUT_EXPERIENCE_CONFIG) private readonly experienceConfig: CheckoutExperienceConfig = { platformFeeBrl: DEFAULT_PLATFORM_FEE_BRL },
    @Optional() @Inject("ProductRepositoryPort") private readonly productRepo?: ProductRepositoryPort
  ) {}

  async build(input: ChatReplyInput & { merchantId: string; sessionId: string }): Promise<ChatMessageResponse> {
    const now = new Date().toISOString();
    await this.sessions.appendChatTurn(input.merchantId, input.sessionId, {
      role: "buyer",
      text: input.userMessage,
      occurredAt: now
    });
    const updated = await this.sessions.appendChatTurn(input.merchantId, input.sessionId, {
      role: "agent",
      text: input.safeMessage.replace(/^(?:Zion|Zyon)\s*:\s*/i, ""),
      occurredAt: new Date().toISOString(),
      authorizedOfferId: input.offer.approved ? input.offer.id : undefined
    });

    const experience = buildExperienceFromSession(updated, {
      merchantName: input.merchant?.name,
      theme: (input.merchant as any)?.theme,
      couponBoxEnabled: input.rules.couponBoxEnabled,
      rules: input.rules,
      serviceFee: this.experienceConfig.platformFeeBrl
    });


    let suggestedProducts: SuggestedProduct[] = [];
    if (!input.isHoldout && input.stage === "payment" && input.previousStage === "shipping" && this.crossSellRecommender) {
      try {
        suggestedProducts = await this.crossSellRecommender.suggest({
          merchant_id: input.merchantId,
          session_id: input.sessionId,
          cart: input.session.cart,
          touchpoint: "pre_payment",
        });
      } catch {
        // cross-sell is non-critical; swallow errors
      }
    }

    if (!input.isHoldout && input.reply.suggested_skus?.length && suggestedProducts.length === 0) {
      if (this.productRepo) {
        const resolved = await Promise.all(
          input.reply.suggested_skus.map((sku) => resolveCrossSellProduct(sku, this.productRepo!, input.merchantId, "llm_suggestion"))
        );
        suggestedProducts = resolved.filter((p): p is SuggestedProduct & { suggestion_id?: string } => p !== null);
      } else {
        this.logger.warn("[chat] productRepo not injected; cannot resolve cross-sell suggested_skus");
      }
    }

    if (suggestedProducts.length === 0 && input.preSearchedProducts.length > 0) {
      suggestedProducts = input.preSearchedProducts;
    }


    const responseExperience: typeof experience = suggestedProducts.length > 0
      ? {
        ...experience,
        suggestedProducts
      }
      : experience;


    const chatActions: any[] = [];
    if (input.offer.approved && input.stage === "payment") {
      const alreadyHasDiscount = input.offer.type.includes("discount") && (input.session.cart.currentDiscount ?? 0) > 0;
      const alreadyHasFreeShipping = input.offer.type.includes("shipping") && input.session.shipping?.customerPrice === 0;
      if (!alreadyHasDiscount && !alreadyHasFreeShipping) {
        chatActions.push({ label: "Aplicar oferta", type: "apply_offer", offer_id: input.offer.id });
      }
    }

    const authorizedOfferResponse = input.offer.toAuthorizedOffer();

    if (this.conversationRepo && updated.globalUserId) {
      try {
        await this.conversationRepo.upsertFromCheckout({
          merchantId: input.merchantId,
          sessionId: input.sessionId,
          globalUserId: updated.globalUserId,
          messages: updated.chatHistory.map((t, idx) => ({
            id: `${input.sessionId}_${idx}`,
            role: t.role,
            content: t.text,
            createdAt: new Date(t.occurredAt),
            rating: null
          }))
        });
      } catch {
        // Conversation persistence is best-effort; never block checkout flow
      }
    }

    const finalStage = input.stage;
    const finalMissingFields = input.missingFields;

    return {
      message: input.safeMessage.replace(/^(?:Zion|Zyon)\s*:\s*/i, ""),
      objection: input.reply.objection,
      authorized_offer: authorizedOfferResponse,
      actions: chatActions,
      turns: updated.chatHistory,
      experience: responseExperience,
      stage: finalStage,
      missing_fields: finalMissingFields,
      blocks: input.reply.blocks
    };
  }
}
