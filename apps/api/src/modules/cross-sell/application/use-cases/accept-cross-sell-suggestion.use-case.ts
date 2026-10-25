import { Injectable, Inject, NotFoundException, BadRequestException, UnprocessableEntityException , Logger} from "@nestjs/common";
import type { Cart, MerchantRules } from "@zyon/shared-types";
import type { PrismaClient } from "@prisma/client";
import { CROSS_SELL_SUGGESTION_REPOSITORY, type CrossSellSuggestionRepository } from "../../domain/ports/cross-sell-suggestion-repository.port.js";
import { CROSS_SELL_PROMOTION_REPOSITORY, type CrossSellPromotionRepository } from "../../domain/ports/cross-sell-promotion-repository.port.js";
import { OUTBOX_REPOSITORY, type OutboxRepository } from "../../../../shared/messaging/ports/outbox.repository.port.js";
import { PRISMA_CLIENT } from "../../../../shared/persistence/persistence.module.js";
import { createCrossSellEventEnvelope } from "../../domain/events/cross-sell-domain-event.js";
import { CorrelationIdStorage } from "../../../../shared/logger/correlation-id.storage.js";

export const CROSS_SELL_QUOTE_REVIEW_REQUIRED = "cross_sell_quote_review_required";
export class CrossSellQuoteReviewRequiredException extends UnprocessableEntityException {
  readonly code = CROSS_SELL_QUOTE_REVIEW_REQUIRED;
  constructor() { super({ statusCode: 422, code: CROSS_SELL_QUOTE_REVIEW_REQUIRED, error: CROSS_SELL_QUOTE_REVIEW_REQUIRED,
    message: "Este benefício precisa de uma nova cotação antes de adicionar o item." }); }
}
type AcceptanceIdentity = { suggestion_id: string; merchant_id: string; session_id: string; accepted_skus: string[] };

@Injectable()
export class AcceptCrossSellSuggestionUseCase {
  private readonly logger = new Logger(AcceptCrossSellSuggestionUseCase.name);

  constructor(
    @Inject(CROSS_SELL_SUGGESTION_REPOSITORY) private readonly suggestions: CrossSellSuggestionRepository,
    @Inject(CROSS_SELL_PROMOTION_REPOSITORY) _promotions: CrossSellPromotionRepository,
    @Inject(OUTBOX_REPOSITORY) private readonly outbox: OutboxRepository,
    @Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient,
  ) {}

  /** Read-only preflight lets the widget refuse before getRules can provision
   * defaults or before resolving/adding any item. Execute revalidates as well. */
  async assertSupportedAcceptance(input: AcceptanceIdentity): Promise<void> {
    await this.prepareAcceptance(input);
  }

  private async prepareAcceptance(input: AcceptanceIdentity) {
    const suggestion = await this.suggestions.findById(input.suggestion_id, input.merchant_id);
    if (!suggestion) throw new NotFoundException("cross_sell_suggestion_not_found");
    if (suggestion.session_id !== input.session_id) throw new BadRequestException("cross_sell_suggestion_session_mismatch");
    let accepted;
    try { accepted = suggestion.accept(input.accepted_skus); }
    catch (err: unknown) {
      throw new BadRequestException(`INVALID_ACCEPTED_SKUS:${err instanceof Error ? err.message : String(err)}`);
    }
    // This immutable entity preparation writes nothing. Only exact numeric zero
    // is an ordinary recommendation. Unknown or explicit benefits need a real
    // post-add, locked, persisted-provenance quotation and read/checkout parity.
    if (accepted.snapshot().computed_discount !== 0) throw new CrossSellQuoteReviewRequiredException();
    return accepted;
  }

  async execute(input: AcceptanceIdentity & {
    /** Legacy input compatibility only; not quotation authority for this guard. */
    cart?: Cart;
    /** Explicit benefits remain refused even with caller-supplied rules. */
    merchantRules?: MerchantRules;
    /** Current stacking context for aggregate cap enforcement (P0 stacking) */
    currentCouponDiscountPercent?: number;
    currentNegotiationDiscountPercent?: number;
  }) {
    const accepted = await this.prepareAcceptance(input);
    const snap = accepted.snapshot();
    // No incentive exists on the supported zero-benefit path. Do not authorize
    // a nonexistent discount or revive the former promotion-cap-only fallback.

    await this.suggestions.save(accepted);

    // Emit funnel event so cross-sell shows up in the conversion funnel.
    // Best-effort: analytics must never break the accept flow.
    try {
      const existing = await this.prisma.checkoutEvent.findFirst({
        where: { merchantId: input.merchant_id, sessionId: input.session_id, eventName: "cross_sell_accepted" },
      });
      if (!existing) {
        await this.prisma.checkoutEvent.create({
          data: { merchantId: input.merchant_id, sessionId: input.session_id, eventName: "cross_sell_accepted", occurredAt: new Date() },
        });
      }
    } catch (err) {
      this.logger.warn(`Failed to record cross_sell_accepted funnel event: ${err instanceof Error ? err.message : String(err)}`);
    }

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
