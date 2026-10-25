import { Inject, Injectable, NotFoundException , Logger} from "@nestjs/common";
import type { AcceptedOffer } from "@zyon/shared-types";
import { AcceptedOfferEntity } from "../../domain/entities/accepted-offer.entity.js";
import { createCheckoutEventEnvelope } from "../../domain/events/checkout-domain-event.js";
import { CHECKOUT_SESSION_REPOSITORY, type CheckoutSessionRepository } from "../../domain/ports/checkout-session.repository.port.js";
import { OFFER_REPOSITORY, type OfferRepository } from "../../domain/ports/offer.repository.port.js";
import { OUTBOX_REPOSITORY, type OutboxRepository } from "../../../../shared/messaging/ports/outbox.repository.port.js";
import { CorrelationIdStorage } from "../../../../shared/logger/correlation-id.storage.js";

@Injectable()
export class AcceptCheckoutOfferUseCase {
  private readonly logger = new Logger(AcceptCheckoutOfferUseCase.name);

  constructor(
    @Inject(CHECKOUT_SESSION_REPOSITORY) private readonly sessions: CheckoutSessionRepository,
    @Inject(OFFER_REPOSITORY) private readonly offers: OfferRepository,
    @Inject(OUTBOX_REPOSITORY) private readonly outbox: OutboxRepository
  ) {}

  async execute(input: { merchant_id: string; session_id: string; offer_id: string }): Promise<AcceptedOffer> {
    const session = await this.sessions.getSession(input.merchant_id, input.session_id);
    if (!session) throw new NotFoundException("checkout_session_not_found");

    const offer = await this.offers.getOffer(input.merchant_id, input.offer_id);
    if (!offer) throw new NotFoundException("offer_not_found");
    // Invariant: reject cross-session reuse of an offer (same merchant, different session).
    if (offer.sessionId !== input.session_id) throw new NotFoundException("offer_not_found");

    const existing = await this.offers.getAcceptedOffer(input.merchant_id, input.session_id, input.offer_id);
    if (existing) return existing;

    const acceptedOffer = AcceptedOfferEntity.accept({
      merchantId: input.merchant_id,
      sessionId: input.session_id,
      offer
    }).snapshot();

    await this.offers.saveAcceptedOffer(acceptedOffer);
    await this.sessions.recordEvent(input.merchant_id, input.session_id, "offer_accepted");
    const updated = await this.sessions.getSession(input.merchant_id, input.session_id);
    await this.outbox.appendOutbox(
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
  }
}
