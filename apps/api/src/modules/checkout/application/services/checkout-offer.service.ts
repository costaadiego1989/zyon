import { Inject, Injectable, Logger, Optional } from "@nestjs/common";
import { evaluateDiscountOffer } from "@zyon/rules-engine";
import { evaluateShippingOffer } from "@zyon/shipping-engine";
import type { ChatStage, CheckoutSession, MerchantRules } from "@zyon/shared-types";
import { CHECKOUT_REPOSITORY, type CheckoutRepository } from "../../domain/ports/checkout-repository.port.js";
import { createAuthorizedOffer } from "../use-cases/offer-factory.js";
import { SafeAuthorizedOffer } from "../../domain/types/safe-authorized-offer.js";
import { EvaluateNegotiationUseCase } from "../../../negotiation/application/evaluate-negotiation.use-case.js";
import { PRISMA_CLIENT } from "../../../../shared/persistence/persistence.module.js";

@Injectable()
export class CheckoutOfferService {
  private readonly logger = new Logger(CheckoutOfferService.name);

  constructor(
    @Inject(CHECKOUT_REPOSITORY) private readonly repository: CheckoutRepository,
    @Optional() private readonly evaluateNegotiation?: EvaluateNegotiationUseCase,
    @Optional() @Inject(PRISMA_CLIENT) private readonly prisma?: any
  ) { }

  /**
   * Authorize an offer using ONLY the rules-engine or shipping-engine.
   * Returns SafeAuthorizedOffer — a type-system barrier that guarantees
   * this offer was authorized by a deterministic engine, NEVER by the LLM.
   *
   * INVARIANT: LLM never authorizes offers. Conversation port writes copy only.
   */
  async authorizeOffer(
    userMessage: string,
    sessionObj: CheckoutSession,
    rules: MerchantRules,
    stage: ChatStage,
    _missingFields: string[]
  ): Promise<SafeAuthorizedOffer> {
    const isDataCollection = stage === "data_collection";
    const isIncompleteShipping = stage === "shipping";

    if (isDataCollection || isIncompleteShipping) {
      const saved = await this.repository.saveOffer(
        createAuthorizedOffer({
          merchantId: sessionObj.merchantId,
          sessionId: sessionObj.sessionId,
          rules,
          evaluation: {
            approved: false,
            type: "none",
            value: 0,
            reason: "complete_customer_before_offers",
            marginAfterOffer: 0
          }
        })
      );
      return SafeAuthorizedOffer.fromRulesEngine(saved);
    }

    // INVARIANT: discount cap comes from `rules.maxDiscountPercent` only.
    // The rules-engine is the sole authority for approving discounts.
    // Conversation-derived signals (objection count, chat history) MUST NOT
    // shape the cap — that would let LLM-influenced state leak into offer math.
    // Objection handling belongs to `conversation-engine` (copy only).
    const discountCapPercent = rules.maxDiscountPercent;

    // Deal Engine: at payment stage, attempt negotiation if merchant has policy
    if (stage === "payment" && this.evaluateNegotiation && this.prisma) {
      try {
        const negotiationPolicy = await this.prisma.merchantNegotiationPolicy?.findUnique?.({
          where: { merchantId: sessionObj.merchantId }
        });
        if (negotiationPolicy?.enabled) {
          const result = this.evaluateNegotiation.execute({
            merchantId: sessionObj.merchantId,
            globalUserId: sessionObj.globalUserId,
            cart: {
              total: sessionObj.cart.total ?? sessionObj.cart.items.reduce((s, i) => s + i.price * i.quantity, 0),
              items: sessionObj.cart.items.map(i => ({ sku: i.sku, price: i.price, quantity: i.quantity }))
            },
            merchantPolicy: {
              enabled: negotiationPolicy.enabled,
              global: negotiationPolicy.global ?? { minOfferDiscountPercent: 3, maxDiscountPercent: discountCapPercent },
              categories: negotiationPolicy.categories ?? [],
              items: negotiationPolicy.items ?? [],
              maxRounds: negotiationPolicy.maxRounds ?? 3,
              maxAiCostCents: negotiationPolicy.maxAiCostCents,
              estimatedCostPerAiCallCents: negotiationPolicy.estimatedCostPerAiCallCents ?? 2
            },
            buyerPreferences: {
              enabled: true,
              targetDiscountPercent: discountCapPercent,
              minimumAcceptableDiscountPercent: 1,
              maxRounds: 3,
              autoAccept: true
            }
          });
          if (result.agreement) {
            const negotiatedDiscount = Math.round(result.selectedDiscountPercent * (sessionObj.cart.total ?? 0) / 100);
            const offer = createAuthorizedOffer({
              merchantId: sessionObj.merchantId,
              sessionId: sessionObj.sessionId,
              rules,
              evaluation: {
                approved: true,
                type: "discount_percent",
                value: result.selectedDiscountPercent,
                reason: `negotiation_agreement_${result.selectedScope}`,
                marginAfterOffer: 0
              }
            });
            const saved = await this.repository.saveOffer(offer);
            return SafeAuthorizedOffer.fromRulesEngine(saved);
          }
          // No agreement — fall through to standard progressive discount
        }
      } catch (err) {
        this.logger.warn("negotiation.evaluate.failed", { error: err instanceof Error ? err.message : String(err) });
        // Non-critical — fall through to standard offer logic
      }
    }

    const wantsShipping = /(frete|envio|shipping)/.test(userMessage.toLowerCase());
    const evaluation = wantsShipping
      ? evaluateShippingOffer({
        cart: sessionObj.cart,
        shipping: sessionObj.shipping,
        rules,
        abandonmentScore: Math.max(sessionObj.abandonmentScore, 0.7)
      })
      : evaluateDiscountOffer(sessionObj.cart, rules, discountCapPercent);

    const offer = createAuthorizedOffer({
      merchantId: sessionObj.merchantId,
      sessionId: sessionObj.sessionId,
      rules,
      evaluation
    });
    const saved = await this.repository.saveOffer(offer);
    // Type-system barrier: wrap in SafeAuthorizedOffer to enforce that only engines authorize.
    return wantsShipping
      ? SafeAuthorizedOffer.fromShippingEngine(saved)
      : SafeAuthorizedOffer.fromRulesEngine(saved);
  }
}
