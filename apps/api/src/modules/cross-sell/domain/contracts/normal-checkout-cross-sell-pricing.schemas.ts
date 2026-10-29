import { z } from "zod";
import { crossSellQuoteCandidateInputSchema } from "./cross-sell-quote.schemas.js";
import { crossSellAcceptedLineIntentSchema } from "./cross-sell-storefront-quote.schemas.js";
import { storefrontSelectedOptionsSchema, storefrontOptionLineIdentity } from "../../../storefront/domain/contracts/storefront-claimed-cart-effect.schemas.js";
import { normalCheckoutCrossSellPricingQuoteSchema, normalCheckoutCrossSellBatchPricingQuoteSchema } from "@zyon/contracts";
export { normalCheckoutCrossSellPricingQuoteSchema, normalCheckoutCrossSellBatchPricingQuoteSchema } from "@zyon/contracts";
export type { NormalCheckoutCrossSellPricingQuote, NormalCheckoutCrossSellBatchPricingQuote } from "@zyon/contracts";

const id = crossSellQuoteCandidateInputSchema.shape.merchantId;
const cents = z.number().int().min(0).max(2_147_483_647);
const quantity = z.number().int().min(1).max(99);
const base = z.strictObject({ variantId: id, productId: id, sku: id, categoryId: id.optional(), quantity,
  baseUnitPriceCents: cents, selectedOptions: storefrontSelectedOptionsSchema.optional() });
const productCandidate = crossSellQuoteCandidateInputSchema.shape.productCandidate;
const canonical = base.extend({ kind: z.literal("canonical"), productCandidate });
const preserved = base.extend({ kind: z.literal("preserved_saved"), savedUnitPriceCents: cents, existingQuantity: quantity })
  .refine(line => line.quantity <= line.existingQuantity && line.savedUnitPriceCents <= line.baseUnitPriceCents);
const accepted = base.extend({ kind: z.literal("accepted_intent"), intent: crossSellAcceptedLineIntentSchema,
  promotion: crossSellQuoteCandidateInputSchema.shape.promotion, productCandidate,
  /** Actual acceptance evidence supplies the sibling target variants absent
   * from that batch's BEFORE cart. Not a persisted intent or public input. */
  excludedTriggerVariantIds: z.array(id).max(200).optional() });

/** INTERNAL server-read calculation sources only. A discriminator/quantity/D
 * is not proof of actual persistence, authorization, stock or transaction scope. */
export const normalCheckoutCrossSellPricingInputSchema = z.strictObject({ merchantId: id,
  now: crossSellQuoteCandidateInputSchema.shape.now,
  policy: z.strictObject({ merchantId: id, maxDiscountPercent: z.number().finite().min(0).max(100) }),
  currentDiscountCents: cents,
  lines: z.array(z.union([canonical, preserved, accepted])).max(200)
    .refine(lines => new Set(lines.map(storefrontOptionLineIdentity)).size === lines.length),
  target: base.extend({ promotion: crossSellQuoteCandidateInputSchema.shape.promotion, productCandidate }),
  catalogVariants: crossSellQuoteCandidateInputSchema.shape.catalogVariants,
});
export type NormalCheckoutCrossSellPricingInput = z.input<typeof normalCheckoutCrossSellPricingInputSchema>;
const reasons = z.enum(["invalid_input", "identity_mismatch", "monetary_overflow", "target_already_present", "catalog_unavailable",
  "catalog_ambiguous", "catalog_mismatch", "base_changed", "product_candidate_invalid", "target_benefit_unavailable",
  "existing_benefit_requires_review", "accepted_price_changed", "tenant_mismatch", "promotion_mismatch", "promotion_changed",
  "promotion_inactive", "promotion_not_started", "promotion_expired", "quantity_exceeds_acceptance", "trigger_not_met"]);
export const normalCheckoutCrossSellPricingResultSchema = z.union([normalCheckoutCrossSellPricingQuoteSchema,
  z.strictObject({ kind: z.literal("requires_review"), reason: reasons })]);
export type NormalCheckoutCrossSellPricingResult = z.infer<typeof normalCheckoutCrossSellPricingResultSchema>;

const { target: targetInput, ...batchInputShape } = normalCheckoutCrossSellPricingInputSchema.shape;
export const normalCheckoutCrossSellBatchPricingInputSchema = z.strictObject({ ...batchInputShape,
  targets: z.array(targetInput).max(200)
    .refine(lines => new Set(lines.map(storefrontOptionLineIdentity)).size === lines.length),
}).refine(value => value.lines.length + value.targets.length <= 200);
export type NormalCheckoutCrossSellBatchPricingInput = z.input<typeof normalCheckoutCrossSellBatchPricingInputSchema>;
export const normalCheckoutCrossSellBatchPricingResultSchema = z.union([normalCheckoutCrossSellBatchPricingQuoteSchema,
  z.strictObject({ kind: z.literal("requires_review"), reason: reasons })]);
export type NormalCheckoutCrossSellBatchPricingResult = z.infer<typeof normalCheckoutCrossSellBatchPricingResultSchema>;
