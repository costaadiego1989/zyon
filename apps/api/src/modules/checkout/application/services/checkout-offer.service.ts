import { Inject, Injectable } from "@nestjs/common";
import { evaluateDiscountOffer } from "@aacp/rules-engine";
import { evaluateShippingOffer } from "@aacp/shipping-engine";
import type { AuthorizedOffer, ChatStage, CheckoutSession, MerchantRules } from "@aacp/shared-types";
import { CHECKOUT_REPOSITORY, type CheckoutRepository } from "../../domain/ports/checkout-repository.port.js";
import { createAuthorizedOffer } from "../use-cases/offer-factory.js";

@Injectable()
export class CheckoutOfferService {
  constructor(
    @Inject(CHECKOUT_REPOSITORY) private readonly repository: CheckoutRepository
  ) { }

  async authorizeOffer(
    userMessage: string,
    sessionObj: CheckoutSession,
    rules: MerchantRules,
    stage: ChatStage,
    _missingFields: string[]
  ): Promise<AuthorizedOffer> {
    const isDataCollection = stage === "data_collection";
    const isIncompleteShipping = stage === "shipping";

    if (isDataCollection || isIncompleteShipping) {
      return this.repository.saveOffer(
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
    return this.repository.saveOffer(offer);
  }
}
