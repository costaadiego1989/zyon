import { BadRequestException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import type { AuthorizedOffer } from "@aacp/shared-types";
import { evaluateDiscountOffer } from "@aacp/rules-engine";
import {
  CHECKOUT_REPOSITORY,
  type CheckoutRepository
} from "../../checkout/domain/ports/checkout-repository.port.js";
import { createAuthorizedOffer } from "../../checkout/application/use-cases/offer-factory.js";
import { checkoutCartFingerprint } from "../domain/cart-fingerprint.js";
import { NEGOTIATION_STORE, type NegotiationStore } from "../domain/ports/negotiation-store.port.js";

@Injectable()
export class ApplyNegotiationAgreementToCheckoutUseCase {
  constructor(
    @Inject(NEGOTIATION_STORE) private readonly store: NegotiationStore,
    @Inject(CHECKOUT_REPOSITORY) private readonly checkout: CheckoutRepository
  ) {}

  async execute(input: {
    merchantId: string;
    negotiationSessionId: string;
    checkoutSessionId: string;
    requestedDiscountPercent: number;
  }): Promise<{ offer: AuthorizedOffer }> {
    const negRow = await this.store.getNegotiationSession(
      input.merchantId,
      input.negotiationSessionId
    );
    if (!negRow) throw new NotFoundException("negotiation_session_not_found");

    const checkoutSession = await this.checkout.getSession(input.merchantId, input.checkoutSessionId);
    if (!checkoutSession) throw new NotFoundException("checkout_session_not_found");

    if (checkoutCartFingerprint(checkoutSession.cart) !== negRow.cartFingerprint) {
      throw new BadRequestException("negotiation_cart_mismatch");
    }

    const r = negRow.result;
    if (!r.agreement) throw new BadRequestException("negotiation_no_agreement");
    if (input.requestedDiscountPercent !== r.selectedDiscountPercent) {
      throw new BadRequestException("negotiation_discount_mismatch");
    }

    const rules = await this.checkout.getRules(input.merchantId);
    const evaluation = evaluateDiscountOffer(
      checkoutSession.cart,
      rules,
      input.requestedDiscountPercent
    );

    if (!evaluation.approved) {
      throw new BadRequestException(`merchant_rules_reject:${evaluation.reason}`);
    }
    if (evaluation.value !== input.requestedDiscountPercent) {
      throw new BadRequestException("negotiation_discount_not_reproducible_under_rules");
    }

    const offer = createAuthorizedOffer({
      merchantId: input.merchantId,
      sessionId: input.checkoutSessionId,
      rules,
      evaluation
    });
    await this.checkout.saveOffer(offer);

    await this.store.appendNegotiationLedgerEntry({
      merchantId: input.merchantId,
      negotiationSessionId: input.negotiationSessionId,
      eventType: "negotiation.offer_applied",
      amountCents: 0
    });

    return { offer };
  }
}
