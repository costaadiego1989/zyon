import { z } from "zod";
import { storefrontWriteAdmissionRequestSchema, storefrontWriteClaimSchema } from "./storefront-write-admission.schemas.js";
import { storefrontWriteScopeSchema } from "./storefront-local-cart-write.schemas.js";
import { commercialNoticesSchema } from "./commercial-notice.schemas.js";

/** Internal trusted effect contract only. Parsing does not authenticate a claim,
 * derive a fingerprint, authorize pricing or expose a new public command. */
export const storefrontClaimedCartEffectRequestSchema = storefrontWriteAdmissionRequestSchema.extend({ claim: storefrontWriteClaimSchema });
const id = storefrontWriteScopeSchema.shape.merchantId;
export const storefrontResolvedLocalCartItemSchema = z.strictObject({
  productId: id, name: z.string().min(1).max(1000), sku: z.string().min(1).max(191),
  unitPriceCents: z.number().int().min(0).max(2_147_483_647), categoryId: id.optional(), imageUrl: z.string().min(1).max(2048).optional(),
});
export const storefrontLocalCartRuleOutcomeSchema = z.strictObject({
  discountCents: z.number().int().min(0).max(2_147_483_647), freeShipping: z.boolean(),
});
const commercialCents = z.number().int().min(0).max(2_147_483_647);
/** Explicit option selections only. Prices/names are server-resolved snapshots,
 * never buyer authority. Missing/empty IDs preserve legacy no-option identity. */
export const storefrontOptionItemIdsSchema = z.array(id).max(250).refine(ids => new Set(ids).size === ids.length);
export const storefrontSelectedOptionSchema = z.strictObject({ groupId: id, groupName: z.string().min(1).max(200),
  itemId: id, itemName: z.string().min(1).max(200), priceModifierInCents: commercialCents });
export const storefrontSelectedOptionsSchema = z.array(storefrontSelectedOptionSchema).max(250)
  .refine(options => new Set(options.map(option => option.itemId)).size === options.length);
export const storefrontOptionLineIdentity = (line: { variantId: string; selectedOptionItemIds?: readonly string[];
  selectedOptions?: readonly { itemId: string }[] }) => JSON.stringify([line.variantId,
    [...(line.selectedOptionItemIds ?? line.selectedOptions?.map(option => option.itemId) ?? [])].sort()]);
/** Transient internal quote, NOT a durable receipt, client authority or shipping grant. */
export const storefrontLocalCartCommercialOutcomeV1Schema = z.strictObject({
  version: z.literal(1), discountCents: commercialCents, freeShipping: z.literal(false),
  quote: z.strictObject({
    currency: z.literal("BRL"), originalSubtotalCents: commercialCents, promotionDiscountCents: commercialCents,
    subtotalCents: commercialCents, merchandiseTotalCents: commercialCents,
    items: z.array(z.strictObject({ variantId: id, productId: id,
      quantity: z.number().int().min(1).max(99), baseUnitPriceCents: commercialCents, unitPriceCents: commercialCents,
      selectedOptionItemIds: storefrontOptionItemIdsSchema.optional(),
    })).min(1).max(200), commercialNotices: commercialNoticesSchema.optional(),
  }),
}).superRefine((outcome, ctx) => {
  const { quote } = outcome;
  const original = quote.items.reduce((sum, item) => sum + BigInt(item.baseUnitPriceCents) * BigInt(item.quantity), 0n);
  const effective = quote.items.reduce((sum, item) => sum + BigInt(item.unitPriceCents) * BigInt(item.quantity), 0n);
  if (new Set(quote.items.map(storefrontOptionLineIdentity)).size !== quote.items.length
    || quote.items.some(item => item.unitPriceCents > item.baseUnitPriceCents)
    || original !== BigInt(quote.originalSubtotalCents) || effective !== BigInt(quote.subtotalCents)
    || original - effective !== BigInt(quote.promotionDiscountCents)
    || effective - BigInt(outcome.discountCents) !== BigInt(quote.merchandiseTotalCents)) {
    ctx.addIssue({ code: "custom", message: "storefront_effect_quote_inconsistent" });
  }
});
export type StorefrontLocalCartCommercialOutcomeV1 = z.infer<typeof storefrontLocalCartCommercialOutcomeV1Schema>;
const reference = { requestId: z.uuid(), effectId: z.uuid(), revision: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER) };
export const storefrontClaimedCartEffectResultSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("effect_recorded"), ...reference }),
  z.strictObject({ kind: z.literal("receipt_required"), ...reference }),
  z.strictObject({ kind: z.literal("scope_unavailable") }),
  z.strictObject({ kind: z.literal("not_current") }),
  z.strictObject({ kind: z.literal("identity_conflict") }),
  z.strictObject({ kind: z.literal("revision_conflict") }),
]);
export type StorefrontClaimedCartEffectRequest = z.infer<typeof storefrontClaimedCartEffectRequestSchema>;
export type StorefrontClaimedCartEffectResult = z.infer<typeof storefrontClaimedCartEffectResultSchema>;
export type StorefrontResolvedLocalCartItem = z.infer<typeof storefrontResolvedLocalCartItemSchema>;
export type StorefrontLocalCartRuleOutcome = z.infer<typeof storefrontLocalCartRuleOutcomeSchema>;

/** Must run before the executor's first await. The admission bytes transform
 * uses Uint8Array.from, detaching even Buffer/subarray backing storage. */
export function snapshotStorefrontClaimedCartEffectRequest(value: unknown) {
  const parsed = storefrontClaimedCartEffectRequestSchema.parse(value);
  Object.freeze(parsed.scope); Object.freeze(parsed.intent.command.args);
  Object.freeze(parsed.intent.command); Object.freeze(parsed.intent);
  Object.freeze(parsed.fingerprint); Object.freeze(parsed.claim);
  return Object.freeze(parsed);
}

