import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import type { AcceptedOffer } from "@aacp/shared-types";
import { AcceptedOfferEntity } from "../../domain/entities/accepted-offer.entity.js";
import { createCheckoutEventEnvelope } from "../../domain/events/checkout-domain-event.js";
import {
  CHECKOUT_REPOSITORY,
  type CheckoutRepository
} from "../../domain/ports/checkout-repository.port.js";
import { withCheckoutTransaction } from "./checkout-transaction.js";

@Injectable()
export class AcceptCheckoutOfferUseCase {
  constructor(@Inject(CHECKOUT_REPOSITORY) private readonly repository: CheckoutRepository) {}

  async execute(input: { merchant_id: string; session_id: string; offer_id: string }): Promise<AcceptedOffer> {
    return withCheckoutTransaction(this.repository, async (repository) => {
    const session = await repository.getSession(input.merchant_id, input.session_id);
    if (!session) throw new NotFoundException("checkout_session_not_found");

    const offer = await repository.getOffer(input.merchant_id, input.offer_id);
    if (!offer) throw new NotFoundException("offer_not_found");

    const existing = await repository.getAcceptedOffer(input.merchant_id, input.session_id, input.offer_id);
    if (existing) return existing;

    const acceptedOffer = AcceptedOfferEntity.accept({
      merchantId: input.merchant_id,
      sessionId: input.session_id,
      offer
    }).snapshot();

    await repository.saveAcceptedOffer(acceptedOffer);
    await repository.recordEvent(input.merchant_id, input.session_id, "offer_accepted");
    const updated = await repository.getSession(input.merchant_id, input.session_id);
    await repository.appendOutbox(
      createCheckoutEventEnvelope({
        eventType: "checkout.event.tracked",
        merchantId: input.merchant_id,
        payload: {
          session_id: input.session_id,
          event_name: "offer_accepted",
          metadata: { offer_id: input.offer_id },
          previous_abandonment_score: session.abandonmentScore,
          next_abandonment_score: updated?.abandonmentScore ?? session.abandonmentScore,
          trigger_agent: updated?.triggerAgent ?? session.triggerAgent
        }
      })
    );

    return acceptedOffer;
    });
  }
}
