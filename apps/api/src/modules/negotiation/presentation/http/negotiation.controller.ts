import { BadRequestException, Body, Controller, Post, Req, UseGuards } from "@nestjs/common";
import { AuthGuard, currentUser } from "../../../auth/presentation/auth.guard.js";
import { EvaluateNegotiationUseCase } from "../../application/evaluate-negotiation.use-case.js";
import { GetMerchantNegotiationPolicyUseCase } from "../../application/merchant-negotiation-policy.use-cases.js";
import { GetBuyerAgentPreferencesUseCase } from "../../application/buyer-agent-preferences.use-cases.js";
import { RecordNegotiationSessionUseCase } from "../../application/record-negotiation-session.use-case.js";
import { ApplyNegotiationAgreementToCheckoutUseCase } from "../../application/apply-negotiation-agreement-to-checkout.use-case.js";
import { negotiationCartFingerprint } from "../../domain/cart-fingerprint.js";

type EvaluateNegotiationBody = {
  cart: Parameters<typeof negotiationCartFingerprint>[0];
  globalUserId?: string;
};

type ApplyCheckoutOfferBody = {
  negotiation_session_id: string;
  checkout_session_id: string;
  requested_discount_percent: number;
  /** Bug 1 fix: must be true when negotiation result has requiresHumanConfirmation. */
  human_confirmed?: boolean;
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

    // Bug 2 fix: always resolve policy/prefs from the authenticated tenant store;
    // never trust body overrides. This prevents fabricated policies corrupting the ledger.
    const merchantPolicy = await this.getMerchantPolicy.executeResolved(user.merchantId);
    const buyerPreferences = await this.getBuyerPreferences.executeResolved({
      merchantId: user.merchantId,
      globalUserId: body.globalUserId
    });

    const result = this.evaluateNegotiation.execute({
      merchantId: user.merchantId,
      globalUserId: body.globalUserId,
      cart: body.cart,
      merchantPolicy,
      buyerPreferences
    });

    // Bug 4 fix: only persist session/ledger when the negotiation actually proceeds
    // (agreement reached or real AI cost incurred). Clean early denials (disabled flags)
    // produce no DB writes — they are free and deterministic from stored policy.
    const isDeniedWithoutAiCost =
      !result.agreement &&
      (result.denialReason === "merchant_machine_negotiation_disabled" ||
        result.denialReason === "buyer_machine_negotiation_disabled" ||
        result.denialReason === "invalid_policy");

    if (isDeniedWithoutAiCost) {
      // Return the denial result without creating a session row.
      return result;
    }

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
    @Body() body: ApplyCheckoutOfferBody
  ) {
    const user = currentUser(request);

    if (body.human_confirmed !== undefined && body.human_confirmed !== true) {
      throw new BadRequestException("human_confirmed_must_be_true");
    }

    return this.applyToCheckout.execute({
      merchantId: user.merchantId,
      negotiationSessionId: body.negotiation_session_id,
      checkoutSessionId: body.checkout_session_id,
      requestedDiscountPercent: body.requested_discount_percent,
      humanConfirmed: body.human_confirmed === true
    });
  }
}
