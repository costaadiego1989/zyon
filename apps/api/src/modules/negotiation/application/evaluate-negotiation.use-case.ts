import { Injectable } from "@nestjs/common";
import {
  negotiateDiscount,
  type BuyerNegotiationPreferences,
  type MerchantNegotiationPolicy,
  type NegotiationCart,
  type NegotiationResult
} from "@zyon/negotiation-engine";

export interface EvaluateNegotiationInput {
  merchantId: string;
  globalUserId?: string;
  cart: NegotiationCart;
  merchantPolicy: MerchantNegotiationPolicy;
  buyerPreferences: BuyerNegotiationPreferences;
}

@Injectable()
export class EvaluateNegotiationUseCase {
  execute(input: EvaluateNegotiationInput): NegotiationResult {
    return negotiateDiscount(input);
  }
}
