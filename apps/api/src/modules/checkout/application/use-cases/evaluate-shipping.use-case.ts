import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import { evaluateShippingOffer } from "@aacp/shipping-engine";
import type { ShippingEvaluateRequest, ShippingEvaluateResponse } from "@aacp/shared-types";
import {
  CHECKOUT_REPOSITORY,
  type CheckoutRepository
} from "../../domain/ports/checkout-repository.port.js";
import { createAuthorizedOffer } from "./offer-factory.js";

@Injectable()
export class EvaluateShippingUseCase {
  constructor(@Inject(CHECKOUT_REPOSITORY) private readonly repository: CheckoutRepository) {}

  async execute(input: ShippingEvaluateRequest): Promise<ShippingEvaluateResponse> {
    const session = await this.repository.getSession(input.merchant_id, input.session_id);
    if (!session) throw new NotFoundException("checkout_session_not_found");
    const rules = await this.repository.getRules(input.merchant_id);
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
    const offer = await this.repository.saveOffer(
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
