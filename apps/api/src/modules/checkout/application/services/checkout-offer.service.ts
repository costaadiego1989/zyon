import { Inject, Injectable } from "@nestjs/common";
import { evaluateDiscountOffer } from "@zyon/rules-engine";
import { evaluateShippingOffer } from "@zyon/shipping-engine";
import type { ChatStage, CheckoutSession, MerchantRules } from "@zyon/shared-types";
import { CHECKOUT_REPOSITORY, type CheckoutRepository } from "../../domain/ports/checkout-repository.port.js";
import { createAuthorizedOffer } from "../use-cases/offer-factory.js";
import { SafeAuthorizedOffer } from "../../domain/types/safe-authorized-offer.js";

@Injectable()
export class CheckoutOfferService {
  constructor(
    @Inject(CHECKOUT_REPOSITORY) private readonly repository: CheckoutRepository
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
