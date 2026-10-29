type EventQuote = { sessionId: string; suggestionId: string; pricing: { targets: ReadonlyArray<{
  promotionId: string; sku: string; originalUnitPriceCents: number; maximumUnitPriceCents: number; acceptedQuantity: number;
}> } };

/** Additive compatibility fields for the existing accepted-event v1 envelope.
 * Pure projection of a validated quote, never price or acceptance authority. */
export function normalCheckoutCrossSellLegacyEventFields(quote: EventQuote) {
  const targets = quote.pricing.targets;
  if (!targets.length || new Set(targets.map(target => target.promotionId)).size !== 1
    || targets.some(target => !target.promotionId || !target.sku
      || !Number.isSafeInteger(target.originalUnitPriceCents) || target.originalUnitPriceCents <= 0
      || !Number.isSafeInteger(target.maximumUnitPriceCents) || target.maximumUnitPriceCents < 0
      || target.maximumUnitPriceCents > target.originalUnitPriceCents
      || !Number.isSafeInteger(target.acceptedQuantity) || target.acceptedQuantity < 1 || target.acceptedQuantity > 99))
    throw new Error("normal_cross_sell_event_invalid");
  const original = targets.reduce((sum, target) => sum + BigInt(target.originalUnitPriceCents) * BigInt(target.acceptedQuantity), 0n);
  const savings = targets.reduce((sum, target) => sum + BigInt(target.originalUnitPriceCents - target.maximumUnitPriceCents) * BigInt(target.acceptedQuantity), 0n);
  return { session_id: quote.sessionId, suggestion_id: quote.suggestionId, promo_id: targets[0]!.promotionId,
    accepted_skus: [...new Set(targets.map(target => target.sku))].sort(),
    computed_discount: Number(savings * 1_000_000n / original) / 10_000 };
}
