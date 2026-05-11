import { Injectable, Inject, NotFoundException } from "@nestjs/common";
import { CROSS_SELL_SUGGESTION_REPOSITORY, type CrossSellSuggestionRepository } from "../../domain/ports/cross-sell-suggestion-repository.port.js";
import { OUTBOX_REPOSITORY, type OutboxRepository } from "../../../../shared/messaging/ports/outbox.repository.port.js";
import { createCrossSellEventEnvelope } from "../../domain/events/cross-sell-domain-event.js";

@Injectable()
export class DeclineCrossSellSuggestionUseCase {
  constructor(
    @Inject(CROSS_SELL_SUGGESTION_REPOSITORY) private readonly suggestions: CrossSellSuggestionRepository,
    @Inject(OUTBOX_REPOSITORY) private readonly outbox: OutboxRepository
  ) {}

  async execute(input: { suggestion_id: string; merchant_id: string; session_id: string }) {
    const suggestion = await this.suggestions.findById(input.suggestion_id, input.merchant_id);
    if (!suggestion) throw new NotFoundException("cross_sell_suggestion_not_found");

    const declined = suggestion.decline();
    await this.suggestions.save(declined);

    const snap = declined.snapshot();
    await this.outbox.appendOutbox(
      createCrossSellEventEnvelope({
        eventType: "cross-sell.offer.declined",
        merchantId: input.merchant_id,
        payload: {
          session_id: input.session_id,
          promo_id: snap.promo_id,
          declined_at: snap.resolved_at!
        }
      })
    );

    return snap;
  }
}
