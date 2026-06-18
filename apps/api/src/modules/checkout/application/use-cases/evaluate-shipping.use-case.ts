import { Inject, Injectable, NotFoundException, Optional } from "@nestjs/common";
import { evaluateShippingOffer } from "@aacp/shipping-engine";
import type { ShippingEvaluateRequest, ShippingEvaluateResponse } from "@aacp/shared-types";
import { DEFAULT_MERCHANT_RULES } from "@aacp/shared-types";
import { CHECKOUT_SESSION_REPOSITORY, type CheckoutSessionRepository } from "../../domain/ports/checkout-session.repository.port.js";
import { OFFER_REPOSITORY, type OfferRepository } from "../../domain/ports/offer.repository.port.js";
import { MERCHANT_RULES_REPOSITORY, type MerchantRulesRepository } from "../../../merchant/domain/ports/merchant-rules.repository.port.js";
import { createAuthorizedOffer } from "./offer-factory.js";

@Injectable()
export class EvaluateShippingUseCase {
  constructor(
    @Inject(CHECKOUT_SESSION_REPOSITORY) private readonly sessions: CheckoutSessionRepository,
    @Inject(OFFER_REPOSITORY) private readonly offers: OfferRepository,
    @Optional() @Inject(MERCHANT_RULES_REPOSITORY) private readonly merchantRepository?: MerchantRulesRepository
  ) {}

  async execute(input: ShippingEvaluateRequest): Promise<ShippingEvaluateResponse> {
    const session = await this.sessions.getSession(input.merchant_id, input.session_id);
    if (!session) throw new NotFoundException("checkout_session_not_found");
    // Safe-deny fallback: when a merchant has no configured rules, premium
    // authorizations (free shipping / shipping discount) must default OFF.
    // Granting them implicitly would let an unconfigured tenant lose margin
    // and bypass the rules-engine authorization boundary. The shared
    // DEFAULT_MERCHANT_RULES is the seed for configured merchants, not a
    // permissive fallback for missing config.
    const rules =
      (await this.merchantRepository?.getRules(input.merchant_id)) ?? {
        ...DEFAULT_MERCHANT_RULES,
        allowFreeShipping: false,
        allowShippingDiscount: false
      };
    const evaluation = evaluateShippingOffer({
      cart: { ...session.cart, total: input.cart_value ?? session.cart.total },
      shipping: {
        ...session.shipping,
        customerPrice: input.shipping_price ?? session.shipping?.customerPrice ?? 0,
        realCost: input.shipping_real_cost ?? session.shipping?.realCost
      },
      rules,
      abandonmentScore: input.abandonment_score ?? session.abandonmentScore
    });
    const offer = await this.offers.saveOffer(
      createAuthorizedOffer({ merchantId: input.merchant_id, sessionId: input.session_id, rules, evaluation })
    );

    return {
      approved: offer.approved,
      action: offer.type,
      reason: offer.reason,
      shipping_subsidy: offer.approved ? offer.value : 0,
      margin_after_offer: offer.marginAfterOffer,
      message: offer.approved
        ? offer.type === "shipping_free"
          ? "Consegui liberar frete gratis para este pedido. Quer aplicar agora?"
          : `Consegui reduzir R$${offer.value.toFixed(2)} do frete. Quer aplicar agora?`
        : "Nao consegui liberar frete com as regras atuais, mas posso te ajudar a continuar com seguranca.",
      offer
    };
  }
}
