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
import { randomUUID } from "node:crypto";

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
}

@Injectable()
export class ChatResponseBuilder {
  private readonly logger = new Logger(ChatResponseBuilder.name);

  constructor(
    @Inject(CHECKOUT_SESSION_REPOSITORY) private readonly sessions: CheckoutSessionRepository,
    @Optional() @Inject(CHECKOUT_CROSS_SELL_RECOMMENDER) private readonly crossSellRecommender?: CheckoutCrossSellRecommenderPort,
    @Optional() private readonly createPaymentIntent?: CreatePaymentIntentUseCase,
    @Optional() @Inject(BUYER_CONVERSATION_REPOSITORY) private readonly conversationRepo?: BuyerConversationRepository,
    @Inject(CHECKOUT_EXPERIENCE_CONFIG) private readonly experienceConfig: CheckoutExperienceConfig = { platformFeeBrl: 1.99 },
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
      text: input.safeMessage,
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

    const wantsPix = /\b(pix|qr code)\b/i.test(input.userMessage) && input.stage === "payment";
    const wantsCard = /\b(cartão|cartao|credito|crédito)\b/i.test(input.userMessage) && input.stage === "payment";
    const wantsBoleto = /\bboleto\b/i.test(input.userMessage) && input.stage === "payment";
    const wantsCrypto = /\b(crypto|cripto|usdc|usdt|polygon|base|carteira|wallet|metamask)\b/i.test(input.userMessage) && input.stage === "payment";

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

    let selectedPaymentMethod: import("@zyon/shared-types").PaymentMethod | undefined;
    if (wantsPix) selectedPaymentMethod = "pix";
    else if (wantsCard) selectedPaymentMethod = "credit_card";
    else if (wantsBoleto) selectedPaymentMethod = "boleto";
    else if (wantsCrypto) selectedPaymentMethod = "crypto";

    let workingSession = input.session;
    if (selectedPaymentMethod && !input.session.paymentMethod) {
      workingSession = {
        ...input.session,
        paymentMethod: selectedPaymentMethod,
        updatedAt: new Date().toISOString()
      } as typeof input.session;
      await this.sessions.saveSession(workingSession);
      this.logger.log(`[chat] payment.method.selected ${selectedPaymentMethod} session=${input.sessionId}`);
      // Record the funnel event with the chosen method so the "por pagamento"
      // breakdown reports real segments (pix / credit_card / boleto / crypto).
      // Deterministic + idempotent (recordEvent no-ops on duplicates per session).
      try {
        await this.sessions.recordEvent(input.merchantId, input.sessionId, "payment_method_selected", {
          payment_method: selectedPaymentMethod,
        });
      } catch {
        /* funnel telemetry is best-effort — never block the checkout reply */
      }
    }

    const responseExperience: typeof experience = suggestedProducts.length > 0
      ? {
        ...experience,
        suggestedProducts
      }
      : experience;

    if (selectedPaymentMethod && this.createPaymentIntent) {
      const intentMethod = selectedPaymentMethod === "credit_card" ? "card" : selectedPaymentMethod;
      const offerApplied =
        input.offer.approved &&
        ((workingSession.cart.currentDiscount ?? 0) > 0 ||
          (workingSession.shipping?.customerPrice === 0));
      try {
        const intent = await this.createPaymentIntent.execute({
          merchant_id: input.merchantId,
          session_id: input.sessionId,
          idempotency_key: randomUUID(),
          method: intentMethod as any,
          ...(offerApplied ? { accepted_offer_id: input.offer.id } : {})
        });
        responseExperience.payment_intent = {
          id: intent.id,
          status: intent.status,
          method: selectedPaymentMethod,
          amount_cents: intent.amountCents,
          currency: intent.currency,
          expires_at: intent.buyerFacing?.quoteExpiresAt,
          qr_code: intent.buyerFacing?.qrCodeCopyPaste,
          qr_code_image: intent.buyerFacing?.encodedQrImage,
          copy_paste: intent.buyerFacing?.qrCodeCopyPaste,
          ticket_url: intent.buyerFacing?.invoiceUrl
        };
        this.logger.log(`[chat] payment.intent.created ${intent.id} status=${intent.status} method=${intentMethod}`);
      } catch (payErr) {
        const errMsg = payErr instanceof Error ? payErr.message : String(payErr);
        const errStack = payErr instanceof Error ? payErr.stack : '';
        this.logger.error(`[chat] payment.intent.FAILED session=${input.sessionId} method=${intentMethod} error="${errMsg}"`, errStack);
        this.logger.error(`[chat] payment.intent.FAILED detail:`, { merchant_id: input.merchantId, session_id: input.sessionId, method: intentMethod, offerApplied, errorMessage: errMsg });
        responseExperience.payment_intent = undefined;
      }
    }

    const chatActions: any[] = [];
    if (wantsPix) {
      chatActions.push({ label: "Gerar PIX", type: "continue_checkout" });
    } else if (wantsCard) {
      chatActions.push({ label: "Pagar com Cartão", type: "continue_checkout" });
    } else if (input.offer.approved && input.stage === "payment") {
      const alreadyHasDiscount = input.offer.type.includes("discount") && workingSession.cart.currentDiscount && workingSession.cart.currentDiscount > 0;
      const alreadyHasFreeShipping = input.offer.type.includes("shipping") && workingSession.shipping?.customerPrice === 0;
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

    const finalStage = selectedPaymentMethod && workingSession.paymentMethod
      ? "payment_pending"
      : input.stage;
    const finalMissingFields = finalStage === "payment_pending" || finalStage === "completed"
      ? []
      : input.missingFields;

    return {
      message: input.safeMessage,
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
