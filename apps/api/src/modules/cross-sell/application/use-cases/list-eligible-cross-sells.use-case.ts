import { Injectable, Inject } from "@nestjs/common";
import type { Cart } from "@aacp/shared-types";
import { CROSS_SELL_PROMOTION_REPOSITORY, type CrossSellPromotionRepository } from "../../domain/ports/cross-sell-promotion-repository.port.js";
import { CROSS_SELL_SUGGESTION_REPOSITORY, type CrossSellSuggestionRepository } from "../../domain/ports/cross-sell-suggestion-repository.port.js";
import { CrossSellSuggestionEntity } from "../../domain/entities/cross-sell-suggestion.entity.js";
import { rankEligiblePromotions } from "../../domain/services/cross-sell-recommender.service.js";
import { OUTBOX_REPOSITORY, type OutboxRepository } from "../../../../shared/messaging/ports/outbox.repository.port.js";
import { createCrossSellEventEnvelope } from "../../domain/events/cross-sell-domain-event.js";

export type ListEligibleCrossSellsInput = {
  session_id: string;
  merchant_id: string;
  cart: Cart;
  agent_copy?: string;
};

@Injectable()
export class ListEligibleCrossSellsUseCase {
  constructor(
    @Inject(CROSS_SELL_PROMOTION_REPOSITORY) private readonly promotions: CrossSellPromotionRepository,
    @Inject(CROSS_SELL_SUGGESTION_REPOSITORY) private readonly suggestions: CrossSellSuggestionRepository,
    @Inject(OUTBOX_REPOSITORY) private readonly outbox: OutboxRepository
  ) {}

  async execute(input: ListEligibleCrossSellsInput) {
    const active = await this.promotions.findActiveByMerchant(input.merchant_id);
    const ranked = rankEligiblePromotions(active, input.cart);

    const created: CrossSellSuggestionEntity[] = [];
    for (const r of ranked) {
      const suggestion = CrossSellSuggestionEntity.create({
        session_id: input.session_id,
        merchant_id: input.merchant_id,
        promo_id: r.promo_id,
        ranked_items: r.ranked_items,
        agent_copy: input.agent_copy ?? "",
        computed_discount: r.discount_percent
      });
      await this.suggestions.save(suggestion);
      await this.outbox.appendOutbox(
        createCrossSellEventEnvelope({
          eventType: "cross-sell.offer.suggested",
          merchantId: input.merchant_id,
          payload: {
            session_id: input.session_id,
            promo_id: r.promo_id,
            ranked_items: r.ranked_items,
            agent_copy: input.agent_copy ?? "",
            suggested_at: suggestion.snapshot().suggested_at
          }
        })
      );
      created.push(suggestion);
    }

    return created.map((s) => s.snapshot());
  }
}
