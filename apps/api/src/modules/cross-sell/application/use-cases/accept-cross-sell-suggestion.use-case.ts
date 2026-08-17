import { Injectable, Inject, NotFoundException, BadRequestException, UnprocessableEntityException , Logger} from "@nestjs/common";
import type { Cart, MerchantRules } from "@zyon/shared-types";
import { CROSS_SELL_SUGGESTION_REPOSITORY, type CrossSellSuggestionRepository } from "../../domain/ports/cross-sell-suggestion-repository.port.js";
import { CROSS_SELL_PROMOTION_REPOSITORY, type CrossSellPromotionRepository } from "../../domain/ports/cross-sell-promotion-repository.port.js";
import { OUTBOX_REPOSITORY, type OutboxRepository } from "../../../../shared/messaging/ports/outbox.repository.port.js";
import { createCrossSellEventEnvelope } from "../../domain/events/cross-sell-domain-event.js";
import { evaluateDiscountOffer } from "@zyon/rules-engine";
import { evaluateStacking } from "../../domain/policies/stacking.policy.js";
import { CorrelationIdStorage } from "../../../../shared/logger/correlation-id.storage.js";

@Injectable()
export class AcceptCrossSellSuggestionUseCase {
  private readonly logger = new Logger(AcceptCrossSellSuggestionUseCase.name);

  constructor(
    @Inject(CROSS_SELL_SUGGESTION_REPOSITORY) private readonly suggestions: CrossSellSuggestionRepository,
    @Inject(CROSS_SELL_PROMOTION_REPOSITORY) private readonly promotions: CrossSellPromotionRepository,
    @Inject(OUTBOX_REPOSITORY) private readonly outbox: OutboxRepository
  ) {}

  async execute(input: {
    suggestion_id: string;
    merchant_id: string;
    session_id: string;
    accepted_skus: string[];
    /** Caller supplies current cart so the rules-engine can check margin (P0) */
    cart?: Cart;
    /** Caller supplies merchant rules for the rules-engine cap check (P0) */
    merchantRules?: MerchantRules;
    /** Current stacking context for aggregate cap enforcement (P0 stacking) */
    currentCouponDiscountPercent?: number;
    currentNegotiationDiscountPercent?: number;
  }) {
    const suggestion = await this.suggestions.findById(input.suggestion_id, input.merchant_id);
    if (!suggestion) throw new NotFoundException("cross_sell_suggestion_not_found");

    // P1 fix: accepted_skus subset validation is enforced in entity.accept()
    // (entity throws if any SKU is outside ranked_items)
    let accepted;
    try {
      accepted = suggestion.accept(input.accepted_skus);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new BadRequestException(`INVALID_ACCEPTED_SKUS:${msg}`);
    }

    const snap = accepted.snapshot();

    // P0 fix: authorize the computed_discount through the rules-engine.
    // If cart + merchantRules are provided, enforce full margin + cap check.
    if (input.cart && input.merchantRules) {
      const evaluation = evaluateDiscountOffer(input.cart, input.merchantRules, snap.computed_discount);
      if (!evaluation.approved) {
        throw new UnprocessableEntityException(`CROSS_SELL_DISCOUNT_REJECTED:${evaluation.reason}`);
      }
    } else {
      // Fallback: enforce promotion-level max_discount_percent cap without full margin check.
      // Fetch the promotion to get max_discount_percent.
      const promotion = await this.promotions.findById(snap.promo_id, input.merchant_id);
      if (promotion) {
        const promoSnap = promotion.snapshot();
        if (snap.computed_discount > promoSnap.max_discount_percent) {
          throw new UnprocessableEntityException(
            `CROSS_SELL_DISCOUNT_EXCEEDS_CAP:computed=${snap.computed_discount}>max=${promoSnap.max_discount_percent}`
          );
        }
      }
    }

    // P0 stacking fix: enforce aggregate discount cap across all discount sources.
    if (input.merchantRules) {
      const stackResult = evaluateStacking({
        crossSellDiscountPercent: snap.computed_discount,
        couponDiscountPercent: input.currentCouponDiscountPercent ?? 0,
        negotiationDiscountPercent: input.currentNegotiationDiscountPercent ?? 0,
        maxDiscountPercent: input.merchantRules.maxDiscountPercent
      });
      if (!stackResult.allowed) {
        throw new UnprocessableEntityException(
          `DISCOUNT_CAP_EXCEEDED:total=${stackResult.totalDiscountPercent}>cap=${stackResult.capPercent}`
        );
      }
    }

    await this.suggestions.save(accepted);

    await this.outbox.appendOutbox(
      createCrossSellEventEnvelope({
        eventType: "cross-sell.offer.accepted",
        merchantId: input.merchant_id,
        payload: {
          session_id: input.session_id,
          promo_id: snap.promo_id,
          accepted_skus: input.accepted_skus,
          computed_discount: snap.computed_discount
        }
      })
    );

    return snap;
  }
}
