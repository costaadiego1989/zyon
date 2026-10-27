import { crossSellQuoteCandidateInputSchema, crossSellQuoteCandidateResultSchema,
  type CrossSellQuoteCandidateResult } from "../contracts/cross-sell-quote.schemas.js";

const percentageUnits = (value: string): bigint => {
  const [whole, fraction = ""] = value.split(".");
  return BigInt(whole!) * 10000n + BigInt(fraction.padEnd(4, "0"));
};
type Reason = Extract<CrossSellQuoteCandidateResult, { kind: "unavailable" }>["reason"];
const unavailable = (reason: Reason): CrossSellQuoteCandidateResult => crossSellQuoteCandidateResultSchema.parse({ kind: "unavailable", reason });

/** Produces a REQUESTED unit-price candidate only, never an approved quotation.
 *
 * Activation prerequisites (not implemented by this boundary):
 * - transactional post-add simulation, original catalog/rules/cost readers;
 * - exclude incompatible plain/benefit merges and quantities beyond acceptance;
 * - authorize whole-cart P+D through the existing allocator/cap/margin engine;
 * - persist BASE plus validated intent, never this effective candidate price;
 * - revalidate trigger/version/base on reads, edits, coupon and checkout;
 * - require re-quotation before any refused/partially permitted explicit add;
 * - keep legacy reduced quotes, marketplace, public protocols and stage33 effect
 *   family blocked until their own ownership, persistence and parity evidence.
 * No clock, IO, principal, TTL, coupon reservation or commercial grant lives here.
 */
export function buildCrossSellQuoteCandidate(value: unknown): CrossSellQuoteCandidateResult {
  const parsed = crossSellQuoteCandidateInputSchema.safeParse(value);
  if (!parsed.success) return unavailable("invalid_input");
  const input = parsed.data, { intent, promotion, target } = input;
  if (promotion.merchantId !== input.merchantId || input.persistedCart.merchantId !== input.merchantId
    || input.catalogVariants.some(row => row.merchantId !== input.merchantId)) return unavailable("tenant_mismatch");
  if (promotion.id !== intent.promotionId) return unavailable("promotion_mismatch");
  if (promotion.updatedAt !== intent.promotionUpdatedAt) return unavailable("promotion_changed");
  if (promotion.status !== "active") return unavailable("promotion_inactive");
  const now = Date.parse(input.now);
  if (Date.parse(promotion.startsAt) > now) return unavailable("promotion_not_started");
  if (promotion.endsAt !== null && Date.parse(promotion.endsAt) <= now) return unavailable("promotion_expired");

  const matches = input.catalogVariants.filter(row => row.sku === target.sku);
  if (!matches.length) return unavailable("catalog_unavailable");
  if (matches.length !== 1) return unavailable("catalog_ambiguous");
  const catalog = matches[0]!;
  if (!catalog.isActive || !catalog.productActive || catalog.productDeletedAt !== null) return unavailable("catalog_unavailable");
  if (catalog.variantId !== target.variantId || catalog.productId !== target.productId || !promotion.recommendedSkus.includes(target.sku)) return unavailable("catalog_mismatch");
  if (BigInt(catalog.baseUnitPriceCents) + BigInt(target.optionModifierCents ?? 0) !== BigInt(intent.originalUnitPriceCents)
    || target.baseUnitPriceCents !== intent.originalUnitPriceCents) return unavailable("base_changed");
  if (target.quantity > intent.acceptedQuantity) return unavailable("quantity_exceeds_acceptance");

  // A viewed product is not persisted trigger authority. On revalidation the
  // accepted target may already exist; it must not qualify its own benefit.
  const context = input.persistedCart.items.filter(item => item.variantId !== target.variantId), trigger = promotion.trigger;
  if ((trigger.skuInCart === undefined && trigger.categoryInCart === undefined && trigger.cartTotalAboveCents === undefined)
    || (trigger.skuInCart !== undefined && !context.some(item => trigger.skuInCart!.includes(item.sku)))
    || (trigger.categoryInCart !== undefined && !context.some(item => item.categoryId !== undefined && trigger.categoryInCart!.includes(item.categoryId)))
    || (trigger.cartTotalAboveCents !== undefined && context.reduce((sum, item) => sum + BigInt(item.unitPriceCents) * BigInt(item.quantity), 0n) <= BigInt(trigger.cartTotalAboveCents))) {
    return unavailable("trigger_not_met");
  }

  const product = input.productCandidate;
  if (product && (product.unitDiscountCents > target.baseUnitPriceCents
    || BigInt(product.unitPriceCents) + BigInt(product.unitDiscountCents) !== BigInt(target.baseUnitPriceCents))) return unavailable("product_candidate_invalid");
  const advertised = percentageUnits(promotion.discountPercent), maximum = percentageUnits(promotion.maxDiscountPercent);
  const bounded = advertised < maximum ? advertised : maximum;
  const saving = Number(BigInt(target.baseUnitPriceCents) * bounded / 1000000n);
  // Equal benefit prefers the automatic product promotion: it does not require
  // a cross-sell acceptance. Neither path adds the two candidate savings.
  if (product && product.unitDiscountCents > 0 && product.unitDiscountCents >= saving) {
    return crossSellQuoteCandidateResultSchema.parse({ kind: "candidate", source: "product", ...product });
  }
  return crossSellQuoteCandidateResultSchema.parse(saving > 0
    ? { kind: "candidate", source: "cross_sell", promotionId: promotion.id, unitPriceCents: target.baseUnitPriceCents - saving, unitDiscountCents: saving }
    : { kind: "candidate", source: "base", unitPriceCents: target.baseUnitPriceCents, unitDiscountCents: 0 });
}

