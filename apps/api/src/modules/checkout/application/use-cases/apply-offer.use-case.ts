import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import type { ApplyOfferRequest, ApplyOfferResponse } from "@aacp/shared-types";
import {
  CHECKOUT_REPOSITORY,
  type CheckoutRepository
} from "../../domain/ports/checkout-repository.port.js";
import { COMMERCE_OFFER_PORT, type CommerceOfferPort } from "../../domain/ports/commerce-offer.port.js";
import { AcceptCheckoutOfferUseCase } from "./accept-checkout-offer.use-case.js";

@Injectable()
export class ApplyOfferUseCase {
  constructor(
    @Inject(CHECKOUT_REPOSITORY) private readonly repository: CheckoutRepository,
    @Inject(COMMERCE_OFFER_PORT) private readonly commerce: CommerceOfferPort,
    private readonly acceptCheckoutOffer: AcceptCheckoutOfferUseCase
  ) {}

  async execute(input: ApplyOfferRequest): Promise<ApplyOfferResponse> {
    const session = await this.repository.getSession(input.merchant_id, input.session_id);
    if (!session) throw new NotFoundException("checkout_session_not_found");
    const offer = await this.repository.getOffer(input.merchant_id, input.offer_id);
    if (!offer || !offer.approved) return { success: false, reason: "offer_not_found_or_not_approved" };
    if (Date.parse(offer.expiresAt) <= Date.now()) return { success: false, reason: "offer_expired" };

    const applied = await this.commerce.apply(offer);
    if (applied.success) {
      await this.acceptCheckoutOffer.execute(input);
    }

    return {
      ...applied,
      new_total: offer.type === "discount_percent" ? session.cart.total * (1 - offer.value / 100) : session.cart.total,
      expires_at: offer.expiresAt
    };
  }
}
