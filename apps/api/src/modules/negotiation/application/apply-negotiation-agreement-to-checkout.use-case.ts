import { BadRequestException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import type { AuthorizedOffer } from "@zyon/shared-types";
import { evaluateDiscountOffer } from "@zyon/rules-engine";
import { CHECKOUT_SESSION_REPOSITORY, type CheckoutSessionRepository } from "../../checkout/domain/ports/checkout-session.repository.port.js";
import { MERCHANT_RULES_REPOSITORY, type MerchantRulesRepository } from "../../merchant/domain/ports/merchant-rules.repository.port.js";
import { OFFER_REPOSITORY, type OfferRepository } from "../../checkout/domain/ports/offer.repository.port.js";
import { createAuthorizedOffer } from "../../checkout/domain/services/offer-factory.js";
import { checkoutCartFingerprint } from "../domain/cart-fingerprint.js";
import { NEGOTIATION_STORE, type NegotiationStore } from "../domain/ports/negotiation-store.port.js";
import { GetMerchantNegotiationPolicyUseCase } from "./merchant-negotiation-policy.use-cases.js";

@Injectable()
export class ApplyNegotiationAgreementToCheckoutUseCase {
  constructor(
    @Inject(NEGOTIATION_STORE) private readonly store: NegotiationStore,
    @Inject(CHECKOUT_SESSION_REPOSITORY) private readonly sessions: CheckoutSessionRepository,
    @Inject(MERCHANT_RULES_REPOSITORY) private readonly merchantRules: MerchantRulesRepository,
    @Inject(OFFER_REPOSITORY) private readonly offers: OfferRepository,
    private readonly getMerchantPolicy: GetMerchantNegotiationPolicyUseCase
  ) {}

  async execute(input: {
    merchantId: string;
    negotiationSessionId: string;
    checkoutSessionId: string;
    requestedDiscountPercent: number;
    /** Bug 1 fix: required true when negotiation snapshot has requiresHumanConfirmation. */
    humanConfirmed?: boolean;
  }): Promise<{ offer: AuthorizedOffer }> {
    const negRow = await this.store.getNegotiationSession(
      input.merchantId,
      input.negotiationSessionId
    );
    if (!negRow) throw new NotFoundException("negotiation_session_not_found");

    // Bug 7 fix: revalidate that merchant negotiation is still enabled at apply-time.
    const currentPolicy = await this.getMerchantPolicy.executeResolved(input.merchantId);
    if (!currentPolicy.enabled) {
      throw new BadRequestException("merchant_negotiation_policy_disabled");
    }

    const checkoutSession = await this.sessions.getSession(input.merchantId, input.checkoutSessionId);
    if (!checkoutSession) throw new NotFoundException("checkout_session_not_found");

    if (checkoutCartFingerprint(checkoutSession.cart) !== negRow.cartFingerprint) {
      throw new BadRequestException("negotiation_cart_mismatch");
    }

    const r = negRow.result;
    if (!r.agreement) throw new BadRequestException("negotiation_no_agreement");
    if (input.requestedDiscountPercent !== r.selectedDiscountPercent) {
      throw new BadRequestException("negotiation_discount_mismatch");
    }

    // Bug 1 fix: enforce human-in-the-loop guardrail.
    // When the negotiation result flagged requiresHumanConfirmation (including
    // threshold === 0 which now works correctly after Bug 9 fix), the caller
    // must pass humanConfirmed: true.
    if (r.requiresHumanConfirmation && !input.humanConfirmed) {
      throw new BadRequestException("human_confirmation_required");
    }

    // Bug 3 fix: idempotency check — if already applied, return the offer
    // re-derived from current rules without creating duplicates.
    if (negRow.appliedAt) {
      const rules = await this.merchantRules.getRules(input.merchantId);
      const evaluation = evaluateDiscountOffer(
        checkoutSession.cart,
        rules,
        negRow.result.selectedDiscountPercent
      );
      if (!evaluation.approved) {
        throw new BadRequestException("merchant_rules_reject_on_replay");
      }
      const offer = createAuthorizedOffer({
        merchantId: input.merchantId,
        sessionId: input.checkoutSessionId,
        rules,
        evaluation
      });
      return { offer };
    }

    const rules = await this.merchantRules.getRules(input.merchantId);
    const evaluation = evaluateDiscountOffer(
      checkoutSession.cart,
      rules,
      input.requestedDiscountPercent
    );

    if (!evaluation.approved) {
      throw new BadRequestException(`merchant_rules_reject:${evaluation.reason}`);
    }
    // C2 fix: explicit cap-down error message instead of opaque "not_reproducible"
    if (evaluation.value !== input.requestedDiscountPercent) {
      throw new BadRequestException(
        `discount_capped: requested ${input.requestedDiscountPercent}%, rules allow max ${evaluation.value}%`
      );
    }

    const offer = createAuthorizedOffer({
      merchantId: input.merchantId,
      sessionId: input.checkoutSessionId,
      rules,
      evaluation
    });
    await this.offers.saveOffer(offer);

    // Bug 6+10 fix: atomic apply — use applyOfferWithLedger which writes the ledger
    // entry recording the actual discountPercent (not 0) and marks session applied.
    await this.store.applyOfferWithLedger({
      merchantId: input.merchantId,
      negotiationSessionId: input.negotiationSessionId,
      checkoutSessionId: input.checkoutSessionId,
      discountPercent: input.requestedDiscountPercent,
      offerData: { id: offer.id }
    });

    return { offer };
  }
}
