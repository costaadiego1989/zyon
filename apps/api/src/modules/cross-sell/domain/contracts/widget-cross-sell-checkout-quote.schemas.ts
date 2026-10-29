import { z } from "zod";
import { isDeepStrictEqual } from "node:util";
import { crossSellQuoteCandidateInputSchema } from "./cross-sell-quote.schemas.js";
import { crossSellAcceptedLineIntentSchema } from "./cross-sell-storefront-quote.schemas.js";
import { storefrontSelectedOptionsSchema, storefrontOptionLineIdentity } from "../../../storefront/domain/contracts/storefront-claimed-cart-effect.schemas.js";

const id = crossSellQuoteCandidateInputSchema.shape.merchantId;
const cents = z.number().int().min(0).max(2_147_483_647);
const quantity = z.number().int().min(1).max(99);
export const widgetCrossSellCheckoutBaseLineSchema = z.strictObject({ variantId: id, productId: id, sku: id,
  categoryId: id.optional(), quantity, baseUnitPriceCents: cents,
  selectedOptions: storefrontSelectedOptionsSchema.optional(),
  productCandidate: crossSellQuoteCandidateInputSchema.shape.productCandidate,
});
const baseLines = z.array(widgetCrossSellCheckoutBaseLineSchema).max(199)
  .refine(lines => new Set(lines.map(storefrontOptionLineIdentity)).size === lines.length);

/** INTERNAL canonical server snapshots. Structure is not proof of DB origin,
 * ownership, complete catalog resolution, stock, payment state or locking. */
export const widgetCrossSellCheckoutQuoteInputSchema = z.strictObject({ merchantId: id,
  now: crossSellQuoteCandidateInputSchema.shape.now,
  suggestion: z.strictObject({ id, merchantId: id, sessionId: id, promotionId: id,
    status: z.enum(["pending", "accepted", "declined"]), rankedSkus: z.array(id).min(1).max(200) }),
  checkout: z.strictObject({ merchantId: id, sessionId: id, persistenceVersion: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
    currency: z.literal("BRL"), items: baseLines, currentDiscountCents: z.literal(0),
    couponCode: z.null(), freeShipping: z.literal(false), hasActiveCouponReservation: z.literal(false) }),
  promotion: crossSellQuoteCandidateInputSchema.shape.promotion,
  catalogVariants: crossSellQuoteCandidateInputSchema.shape.catalogVariants,
  target: widgetCrossSellCheckoutBaseLineSchema,
  policy: z.strictObject({ merchantId: id, maxDiscountPercent: z.number().finite().min(0).max(100) }),
});
export type WidgetCrossSellCheckoutQuoteInput = z.input<typeof widgetCrossSellCheckoutQuoteInputSchema>;

const projectedLine = widgetCrossSellCheckoutBaseLineSchema.extend({ unitPriceCents: cents });
export const widgetCrossSellCheckoutQuoteSchema = z.strictObject({ kind: z.literal("quote_candidate"), version: z.literal(1),
  merchantId: id, sessionId: id, persistenceVersion: widgetCrossSellCheckoutQuoteInputSchema.shape.checkout.shape.persistenceVersion,
  suggestionId: id, quotedAt: crossSellQuoteCandidateInputSchema.shape.now,
  checkoutBasis: widgetCrossSellCheckoutQuoteInputSchema.shape.checkout,
  target: crossSellAcceptedLineIntentSchema.extend({ variantId: id, productId: id, sku: id,
    source: z.enum(["product", "cross_sell"]) }),
  items: z.array(projectedLine).min(1).max(200), originalSubtotalCents: cents,
  promotionDiscountCents: cents, totalCents: cents,
  notice: z.enum(["discount_limit_reached", "discount_limited"]).optional(),
}).superRefine((value, ctx) => {
  const original = value.items.reduce((sum, line) => sum + BigInt(line.baseUnitPriceCents) * BigInt(line.quantity), 0n);
  const effective = value.items.reduce((sum, line) => sum + BigInt(line.unitPriceCents) * BigInt(line.quantity), 0n);
  const target = value.items.filter(line => line.variantId === value.target.variantId);
  if (value.merchantId !== value.checkoutBasis.merchantId || value.sessionId !== value.checkoutBasis.sessionId
    || value.persistenceVersion !== value.checkoutBasis.persistenceVersion
    || value.checkoutBasis.items.some(line => line.variantId === value.target.variantId)
    || new Set(value.items.map(storefrontOptionLineIdentity)).size !== value.items.length
    || value.items.some(line => line.unitPriceCents > line.baseUnitPriceCents)
    || value.items.length !== value.checkoutBasis.items.length + 1
    || value.checkoutBasis.items.some(base => !value.items.some(line => {
      const { unitPriceCents: _effective, ...snapshot } = line;
      return isDeepStrictEqual(snapshot, base);
    }))
    || target.length !== 1 || target[0]!.productId !== value.target.productId || target[0]!.sku !== value.target.sku
    || storefrontOptionLineIdentity(target[0]!) !== storefrontOptionLineIdentity(value.target)
    || target[0]!.quantity !== value.target.acceptedQuantity || target[0]!.baseUnitPriceCents !== value.target.originalUnitPriceCents
    || target[0]!.unitPriceCents !== value.target.maximumUnitPriceCents
    || value.target.maximumUnitPriceCents >= value.target.originalUnitPriceCents
    || original !== BigInt(value.originalSubtotalCents) || effective !== BigInt(value.totalCents)
    || original - effective !== BigInt(value.promotionDiscountCents)) {
    ctx.addIssue({ code: "custom", message: "widget_cross_sell_checkout_quote_inconsistent" });
  }
});
const reason = z.enum(["invalid_input", "identity_mismatch", "suggestion_unavailable", "target_already_present", "monetary_overflow",
  "target_benefit_unavailable", "product_candidate_invalid", "tenant_mismatch", "promotion_mismatch", "promotion_changed", "promotion_inactive",
  "promotion_not_started", "promotion_expired", "catalog_ambiguous", "catalog_mismatch", "catalog_unavailable", "base_changed",
  "quantity_exceeds_acceptance", "trigger_not_met"]);
export const widgetCrossSellCheckoutQuoteResultSchema = z.union([widgetCrossSellCheckoutQuoteSchema,
  z.strictObject({ kind: z.literal("requires_review"), reason })]);
export type WidgetCrossSellCheckoutQuoteResult = z.infer<typeof widgetCrossSellCheckoutQuoteResultSchema>;
export type WidgetCrossSellCheckoutQuote = z.infer<typeof widgetCrossSellCheckoutQuoteSchema>;
