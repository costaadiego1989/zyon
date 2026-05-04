import { Body, Controller, Post, Req, UseGuards } from "@nestjs/common";
import { AuthGuard, currentUser } from "../../../auth/presentation/auth.guard.js";
import {
  EvaluateNegotiationUseCase,
  type EvaluateNegotiationInput
} from "../../application/evaluate-negotiation.use-case.js";
import { GetMerchantNegotiationPolicyUseCase } from "../../application/merchant-negotiation-policy.use-cases.js";
import { GetBuyerAgentPreferencesUseCase } from "../../application/buyer-agent-preferences.use-cases.js";
import { RecordNegotiationSessionUseCase } from "../../application/record-negotiation-session.use-case.js";
import { ApplyNegotiationAgreementToCheckoutUseCase } from "../../application/apply-negotiation-agreement-to-checkout.use-case.js";
import { negotiationCartFingerprint } from "../../domain/cart-fingerprint.js";

type EvaluateNegotiationBody = Pick<EvaluateNegotiationInput, "cart"> &
  Partial<Pick<EvaluateNegotiationInput, "merchantPolicy" | "buyerPreferences" | "globalUserId">> & {
    merchantId?: string;
    merchant_id?: string;
  };

@UseGuards(AuthGuard)
@Controller("negotiations")
export class NegotiationController {
  constructor(
    private readonly evaluateNegotiation: EvaluateNegotiationUseCase,
    private readonly getMerchantPolicy: GetMerchantNegotiationPolicyUseCase,
    private readonly getBuyerPreferences: GetBuyerAgentPreferencesUseCase,
    private readonly recordSession: RecordNegotiationSessionUseCase,
    private readonly applyToCheckout: ApplyNegotiationAgreementToCheckoutUseCase
  ) {}

  @Post("evaluate")
  async evaluate(@Req() request: { user?: unknown }, @Body() body: EvaluateNegotiationBody) {
    const user = currentUser(request);

    const merchantPolicy =
      body.merchantPolicy ??
      (await this.getMerchantPolicy.executeResolved(user.merchantId));
    const buyerPreferences =
      body.buyerPreferences ??
      (await this.getBuyerPreferences.executeResolved({
        merchantId: user.merchantId,
        globalUserId: body.globalUserId
      }));

    const result = this.evaluateNegotiation.execute({
      merchantId: user.merchantId,
      globalUserId: body.globalUserId,
      cart: body.cart,
      merchantPolicy,
      buyerPreferences
    });

    const { negotiation_session_id } = await this.recordSession.execute({
      merchantId: user.merchantId,
      globalUserId: body.globalUserId,
      cartFingerprint: negotiationCartFingerprint(body.cart),
      result
    });

    return { ...result, negotiation_session_id };
  }

  @Post("apply-checkout-offer")
  async applyCheckoutOffer(
    @Req() request: { user?: unknown },
    @Body()
    body: {
      negotiation_session_id: string;
      checkout_session_id: string;
      requested_discount_percent: number;
    }
  ) {
    const user = currentUser(request);
    return this.applyToCheckout.execute({
      merchantId: user.merchantId,
      negotiationSessionId: body.negotiation_session_id,
      checkoutSessionId: body.checkout_session_id,
      requestedDiscountPercent: body.requested_discount_percent
    });
  }
}
