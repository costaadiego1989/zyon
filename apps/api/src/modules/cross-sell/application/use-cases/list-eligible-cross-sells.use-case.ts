import { Injectable, Inject , Logger, Optional} from "@nestjs/common";
import type { Cart } from "@zyon/shared-types";
import { CROSS_SELL_PROMOTION_REPOSITORY, type CrossSellPromotionRepository } from "../../domain/ports/cross-sell-promotion-repository.port.js";
import { CROSS_SELL_SUGGESTION_REPOSITORY, type CrossSellSuggestionRepository } from "../../domain/ports/cross-sell-suggestion-repository.port.js";
import { CrossSellSuggestionEntity } from "../../domain/entities/cross-sell-suggestion.entity.js";
import { rankEligiblePromotions, type PurchaseHistoryBias } from "../../domain/services/cross-sell-recommender.service.js";
import { OUTBOX_REPOSITORY, type OutboxRepository } from "../../../../shared/messaging/ports/outbox.repository.port.js";
import { createCrossSellEventEnvelope } from "../../domain/events/cross-sell-domain-event.js";
import { CorrelationIdStorage } from "../../../../shared/logger/correlation-id.storage.js";
import { GetBuyerPurchaseContextUseCase } from "../../../buyer-purchase-history/application/buyer-purchase-history.use-cases.js";

export type ListEligibleCrossSellsInput = {
  session_id: string;
  merchant_id: string;
  cart: Cart;
  /** When provided, ranking is biased toward this buyer's purchase history. */
  global_user_id?: string;
  /** When provided alongside global_user_id, used as the merchant-scoped identity. */
  merchant_customer_id?: string;
  agent_copy?: string;
};

@Injectable()
export class ListEligibleCrossSellsUseCase {
  private readonly logger = new Logger(ListEligibleCrossSellsUseCase.name);

  constructor(
    @Inject(CROSS_SELL_PROMOTION_REPOSITORY) private readonly promotions: CrossSellPromotionRepository,
    @Inject(CROSS_SELL_SUGGESTION_REPOSITORY) private readonly suggestions: CrossSellSuggestionRepository,
    @Inject(OUTBOX_REPOSITORY) private readonly outbox: OutboxRepository,
    @Optional() private readonly getBuyerContext?: GetBuyerPurchaseContextUseCase,
  ) {}

  async execute(input: ListEligibleCrossSellsInput) {
    const active = await this.promotions.findActiveByMerchant(input.merchant_id);

    let historyBias: PurchaseHistoryBias | undefined;
    if (this.getBuyerContext && input.global_user_id) {
      try {
        const ctx = await this.getBuyerContext.execute({
          merchantId: input.merchant_id,
          globalUserId: input.global_user_id,
          merchantCustomerId: input.merchant_customer_id
        });
        if (ctx.purchase_history.known_buyer) {
          historyBias = {
            top_categories: ctx.purchase_history.top_categories,
            recent_skus: ctx.purchase_history.recent_skus
          };
        }
      } catch (err) {
        // History lookup must never block checkout — fall back to discount-only ranking.
        this.logger.warn("[cross-sell] purchase history lookup failed; using discount-only ranking");
      }
    }

    const ranked = rankEligiblePromotions(active, input.cart, historyBias);

    // P2 fix: load existing pending suggestions for this session so we can
    // skip promo_ids that already have a pending suggestion (no duplicates).
    const existingSuggestions = await this.suggestions.findBySession(
      input.session_id,
      input.merchant_id
    );
    const pendingPromoIds = new Set(
      existingSuggestions
        .filter((s) => s.snapshot().status === "pending")
        .map((s) => s.snapshot().promo_id)
    );

    const result: CrossSellSuggestionEntity[] = [];
    for (const r of ranked) {
      // P2 fix: skip if a pending suggestion for this promo already exists
      if (pendingPromoIds.has(r.promo_id)) {
        const existing = existingSuggestions.find(
          (s) => s.snapshot().promo_id === r.promo_id && s.snapshot().status === "pending"
        );
        if (existing) {
          result.push(existing);
          continue;
        }
      }

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
      result.push(suggestion);
    }

    return result.map((s) => s.snapshot());
  }
}
