import { Injectable } from "@nestjs/common";
import { evaluateDiscountOffer } from "@zyon/rules-engine";
import type { Cart, MerchantRules } from "@zyon/shared-types";
import type { DiscountAuthorization, DiscountRulesEnginePort } from "../../domain/ports/discount-rules-engine.port.js";

@Injectable()
export class RulesEngineDiscountAdapter implements DiscountRulesEnginePort {
  authorizeDiscount(
    cart: Cart,
    rules: MerchantRules,
    requestedDiscountValue: number,
    discountType: "percent" | "fixed"
  ): DiscountAuthorization {
    // Convert fixed discount to a percent for the engine
    const requestedPercent =
      discountType === "percent"
        ? requestedDiscountValue
        : cart.total > 0
          ? (requestedDiscountValue / cart.total) * 100
          : 0;

    const result = evaluateDiscountOffer(cart, rules, requestedPercent);

    if (!result.approved) {
      return { approved: false, authorizedDiscount: 0, reason: result.reason };
    }

    // Convert authorized percent back to the original unit
    const authorizedDiscount =
      discountType === "percent"
        ? result.value
        : (result.value / 100) * cart.total;

    return { approved: true, authorizedDiscount, reason: result.reason };
  }
}
