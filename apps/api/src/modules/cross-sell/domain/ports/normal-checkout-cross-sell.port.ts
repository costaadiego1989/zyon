import type { CheckoutSession } from "@zyon/shared-types";
import type { NormalCheckoutBenefitsCommand, NormalCheckoutOfferCommand } from "../../../checkout/domain/contracts/normal-commercial-benefit-proof.schemas.js";
import type { NormalCheckoutCrossSellScope, NormalCheckoutCrossSellQuoteRequest, NormalCheckoutCrossSellQuote,
  NormalCheckoutCrossSellAcceptance, NormalCheckoutCrossSellAcknowledgement } from "../contracts/normal-checkout-cross-sell-command.schemas.js";

export const NORMAL_CHECKOUT_CROSS_SELL = Symbol("NORMAL_CHECKOUT_CROSS_SELL");
export interface NormalCheckoutCrossSellCartMutation {
  expectedVersion: number;
  items: Array<{sku:string;quantity:number;variant?:string}>;
}
/** Authenticated application scope is separate from compare-only public JSON.
 * Implementations reread actual sources and own their transaction/fences. */
export interface NormalCheckoutCrossSellPort {
  quote(scope: NormalCheckoutCrossSellScope, request: NormalCheckoutCrossSellQuoteRequest): Promise<NormalCheckoutCrossSellQuote>;
  accept(scope: NormalCheckoutCrossSellScope, request: NormalCheckoutCrossSellAcceptance): Promise<NormalCheckoutCrossSellAcknowledgement>;
  /** Expected is a concurrency precondition only, never a financial source.
   * Return the actual scoped session with a canonically verified projection. */
  read(scope: NormalCheckoutCrossSellScope, expected?: CheckoutSession): Promise<CheckoutSession>;
  updateCart(scope: NormalCheckoutCrossSellScope, request:NormalCheckoutCrossSellCartMutation):Promise<CheckoutSession>;
  prepareBenefits(scope: NormalCheckoutCrossSellScope, request: NormalCheckoutBenefitsCommand): Promise<{session: CheckoutSession; couponCode?: string}>;
  applyOffer(scope: NormalCheckoutCrossSellScope, request: NormalCheckoutOfferCommand): Promise<{session:CheckoutSession;
    offer:{id:string;type:"discount_fixed"|"discount_percent";value:number;expiresAt:string}}>;
}
