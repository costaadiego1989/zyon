import { Injectable , Logger} from "@nestjs/common";
import {
  negotiateDiscount,
  type BuyerNegotiationPreferences,
  type MerchantNegotiationPolicy,
  type NegotiationCart,
  type NegotiationResult
} from "@zyon/negotiation-engine";
import { CorrelationIdStorage } from "../../../shared/logger/correlation-id.storage.js";

export interface EvaluateNegotiationInput {
  merchantId: string;
  globalUserId?: string;
  cart: NegotiationCart;
  merchantPolicy: MerchantNegotiationPolicy;
  buyerPreferences: BuyerNegotiationPreferences;
}

@Injectable()
export class EvaluateNegotiationUseCase {
  private readonly logger = new Logger(EvaluateNegotiationUseCase.name);

  execute(input: EvaluateNegotiationInput): NegotiationResult {
    return negotiateDiscount(input);
  }
}
