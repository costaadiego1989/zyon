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

    const objectionRegex = /(caro|desconto|cupom|preco|preço|valor|melhorar|abaixar)/i;
    let objectionCount = 0;
    if (Array.isArray(sessionObj.chatHistory)) {
      for (const turn of sessionObj.chatHistory) {
        if (turn.role === "buyer" && objectionRegex.test(turn.text)) {
          objectionCount++;
        }
      }
    }
    if (objectionRegex.test(userMessage)) objectionCount++;

    let dynamicMaxPercent = rules.maxDiscountPercent;
    if (rules.maxDiscountPercent > 0) {
      if (objectionCount <= 1) {
        dynamicMaxPercent = Math.round(rules.maxDiscountPercent * 0.33);
      } else if (objectionCount === 2) {
        dynamicMaxPercent = Math.round(rules.maxDiscountPercent * 0.66);
      }
    }
    dynamicMaxPercent = Math.min(dynamicMaxPercent, rules.maxDiscountPercent);

    const wantsShipping = /(frete|envio|shipping)/.test(userMessage.toLowerCase());
    const evaluation = wantsShipping
      ? evaluateShippingOffer({
        cart: sessionObj.cart,
        shipping: sessionObj.shipping,
        rules,
        abandonmentScore: Math.max(sessionObj.abandonmentScore, 0.7)
      })
      : evaluateDiscountOffer(sessionObj.cart, rules, dynamicMaxPercent);

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
