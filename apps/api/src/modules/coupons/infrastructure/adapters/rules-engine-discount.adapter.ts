import { Injectable } from "@nestjs/common";
import { evaluateDiscountOffer,evaluateCombinedDiscount,moneyCents } from "@zyon/rules-engine";
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
    if(discountType==="fixed"){
      const requested=moneyCents(requestedDiscountValue);
      if(requested===null||requested<=0||cart.total<=0)return{approved:false,authorizedDiscount:0,reason:requested===null?"economic_input_invalid":"discount_not_requested"};
      // Fixed money is already denominated in cents. Converting it to a
      // repeating decimal percent and flooring it again can lose a cent.
      // The shared engine preserves monetary/currency/existing-P+D guards.
      const decision=evaluateCombinedDiscount(cart,rules,requested);
      if(decision.kind!=="authorized"||decision.cartDiscountCents<=0)return{approved:false,authorizedDiscount:0,reason:decision.reason};
      return{approved:true,authorizedDiscount:decision.cartDiscountCents/100,authorizedDiscountCents:decision.cartDiscountCents,reason:decision.reason};
    }
    const result = evaluateDiscountOffer(cart, rules, requestedDiscountValue);

    if (!result.approved) {
      return { approved: false, authorizedDiscount: 0, reason: result.reason };
    }

    const authorizedDiscountCents=moneyCents((result.value/100)*cart.total);
    return { approved: true, authorizedDiscount:result.value, ...(authorizedDiscountCents===null?{}:{authorizedDiscountCents}),reason: result.reason };
  }
}
