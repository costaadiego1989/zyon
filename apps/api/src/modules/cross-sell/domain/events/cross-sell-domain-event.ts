import type { CrossSellDomainEventType, DomainEventEnvelope } from "@zyon/shared-types";
import type { WidgetCrossSellCheckoutQuote } from "../contracts/widget-cross-sell-checkout-quote.schemas.js";

/** Exact deterministic evidence shared by the internal acceptance writer and
 * reader. Neither this calculation nor a matching JSON payload is authority. */
export function widgetCrossSellCheckoutAcceptancePayload(quote: WidgetCrossSellCheckoutQuote, committedVersion: number) {
  const saving = quote.target.originalUnitPriceCents - quote.target.maximumUnitPriceCents;
  return { session_id: quote.sessionId, suggestion_id: quote.suggestionId, promo_id: quote.target.promotionId,
    accepted_skus: [quote.target.sku], computed_discount: Number(BigInt(saving) * 1_000_000n / BigInt(quote.target.originalUnitPriceCents)) / 10_000,
    quantity: quote.target.acceptedQuantity, discount_cents: saving * quote.target.acceptedQuantity,
    original_subtotal_cents: quote.originalSubtotalCents, promotion_discount_cents: quote.promotionDiscountCents,
    total_cents: quote.totalCents, checkout_version: committedVersion };
}

export function createCrossSellEventEnvelope<TPayload extends Record<string, unknown>>(input: {
  eventType: CrossSellDomainEventType;
  merchantId: string;
  payload: TPayload;
  causationId?: string;
}): DomainEventEnvelope<TPayload> {
  return {
    event_id: `evt_${crypto.randomUUID()}`,
    event_type: input.eventType,
    schema_version: 1,
    merchant_id: input.merchantId,
    occurred_at: new Date().toISOString(),
    correlation_id: `corr_${crypto.randomUUID()}`,
    causation_id: input.causationId ?? input.eventType,
    producer: "cross-sell",
    payload: input.payload
  };
}
