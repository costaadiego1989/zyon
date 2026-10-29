import { z } from "zod";

const id = z.string().min(1).max(191).refine(value => value.trim().length > 0 && !value.includes("\0")
  && !Array.from(value).some(character => { const point = character.codePointAt(0)!; return point >= 0xd800 && point <= 0xdfff; }));
const cents = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const quantity = z.number().int().min(1).max(99);
const instant = z.iso.datetime({ offset: true });

/** Decimal.toString() at the trusted reader boundary, never Number/parseFloat.
 * Text is preserved, with no rounding/coercion or exponent notation. */
export const crossSellPercentageSchema = z.string().max(13).regex(/^(?:0|[1-9]\d*)(?:\.\d{1,4})?$/)
  .refine(value => value === value.trim())
  .pipe(z.string().refine(value => {
    const [whole, fraction = ""] = value.split(".");
    return BigInt(whole!) * 10000n + BigInt(fraction.padEnd(4, "0")) <= 1000000n;
  }));

/** Server-owned acceptance intent, not a bearer capability or granted saving. */
export const crossSellIntentV1Schema = z.strictObject({ version: z.literal(1), promotionId: id,
  promotionUpdatedAt: instant, acceptedQuantity: quantity, originalUnitPriceCents: cents });
export type CrossSellIntentV1 = z.infer<typeof crossSellIntentV1Schema>;

const cartLine = z.strictObject({ variantId: id, productId: id, sku: id, categoryId: id.optional(), quantity, unitPriceCents: cents });
const persistedCart = z.strictObject({ kind: z.literal("persisted_cart"), merchantId: id,
  subtotalCents: cents, items: z.array(cartLine).max(200) }).refine(cart => {
    const sum = cart.items.reduce((total, item) => total + BigInt(item.unitPriceCents) * BigInt(item.quantity), 0n);
    return sum <= BigInt(Number.MAX_SAFE_INTEGER) && sum === BigInt(cart.subtotalCents);
  });
const promotion = z.strictObject({ id, merchantId: id, updatedAt: instant, status: z.enum(["active", "archived"]),
  startsAt: instant, endsAt: instant.nullable(), recommendedSkus: z.array(id).min(1).max(200),
  discountPercent: crossSellPercentageSchema, maxDiscountPercent: crossSellPercentageSchema,
  // Reader must convert legacy trigger.cart_total_above BRL into exact cents.
  // Unit/normalization authority must not be inferred from arbitrary JSON here.
  trigger: z.strictObject({ skuInCart: z.array(id).min(1).max(200).optional(), categoryInCart: z.array(id).min(1).max(200).optional(),
    cartTotalAboveCents: cents.optional() }),
}).refine(value => value.endsAt === null || Date.parse(value.startsAt) < Date.parse(value.endsAt));
const catalogVariant = z.strictObject({ variantId: id, productId: id, sku: id, merchantId: id, isActive: z.boolean(),
  productActive: z.boolean(), productDeletedAt: instant.nullable(), currency: z.literal("BRL"), baseUnitPriceCents: cents });
const productCandidate = z.strictObject({ promotionId: id, unitPriceCents: cents, unitDiscountCents: cents });

/** Only explicit SERVER-authoritative snapshots belong here. The discriminator
 * describes provenance but does not authenticate it; this pure helper cannot
 * prove a DB query's completeness, principal, persisted ownership or freshness.
 * catalogVariants must be the complete exact-SKU tenant resolution, not first(). */
export const crossSellQuoteCandidateInputSchema = z.strictObject({ merchantId: id, now: instant,
  intent: crossSellIntentV1Schema, promotion,
  target: z.strictObject({ variantId: id, productId: id, sku: id, quantity, baseUnitPriceCents: cents, optionModifierCents: cents.optional() }),
  catalogVariants: z.array(catalogVariant).max(200), persistedCart, productCandidate: productCandidate.optional(),
});
export type CrossSellQuoteCandidateInput = z.input<typeof crossSellQuoteCandidateInputSchema>;

const unavailableReason = z.enum(["invalid_input", "tenant_mismatch", "promotion_mismatch", "promotion_changed", "promotion_inactive",
  "promotion_not_started", "promotion_expired", "catalog_ambiguous", "catalog_mismatch", "catalog_unavailable", "base_changed",
  "quantity_exceeds_acceptance", "trigger_not_met", "product_candidate_invalid"]);
const candidate = z.strictObject({ kind: z.literal("candidate"), source: z.enum(["product", "cross_sell"]), promotionId: id,
  unitPriceCents: cents, unitDiscountCents: cents.refine(value => value > 0) });
const base = z.strictObject({ kind: z.literal("candidate"), source: z.literal("base"), unitPriceCents: cents, unitDiscountCents: z.literal(0) });
export const crossSellQuoteCandidateResultSchema = z.union([candidate, base, z.strictObject({ kind: z.literal("unavailable"), reason: unavailableReason })]);
export type CrossSellQuoteCandidateResult = z.infer<typeof crossSellQuoteCandidateResultSchema>;

