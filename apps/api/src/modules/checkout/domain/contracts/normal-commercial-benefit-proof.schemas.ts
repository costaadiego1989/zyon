import { z } from "zod";

const ref = z.string().min(1).max(200).refine(value => value.trim() === value && !value.includes("\0"));
const cents = z.number().int().positive().max(2_147_483_647);
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const identity = { merchantId: ref, checkoutSessionId: ref, buyerId: ref, discountCents: cents };
/** Private comparison evidence only. Actual scoped policy/events/offer records
 * and deterministic engines must authorize the amount in the caller's SQL TX. */
export const normalCheckoutPolicyDiscountOwnerSchema = z.strictObject({ kind: z.literal("checkout_policy"), ...identity,
  authorizationEventId: ref,
  origin: z.enum(["progressive", "advanced_rule"]), paymentMethod: z.enum(["pix", "card", "boleto", "crypto"]),
  settingsHash: hash, eventIds: z.array(ref).min(1).max(10000).refine(ids => new Set(ids).size === ids.length), ruleId: ref.optional() });
export const normalCheckoutAcceptedOfferDiscountOwnerSchema = z.strictObject({ kind: z.literal("accepted_offer"), ...identity,
  authorizationEventId: ref, authorizedOfferId: ref, acceptedOfferRowId: ref, termsHash: hash });
const nonnegativeCents = cents.or(z.literal(0));
const basisItem = z.strictObject({ sku: ref, variantId: ref, productId: ref, quantity: z.number().int().min(1).max(99),
  baseUnitPriceCents: nonnegativeCents, unitPriceCents: nonnegativeCents,
  optionItemIds: z.array(ref).max(250).refine(ids => new Set(ids).size === ids.length) });
export const NORMAL_COMMERCIAL_BENEFIT_EVENT = "checkout_commercial_benefit_authorized";
export const normalCommercialBenefitAuthorizationSchema = z.strictObject({ version: z.literal(1), merchantId: ref,
  checkoutSessionId: ref, buyerId: ref, checkoutVersion: z.number().int().positive().max(2_147_483_647),
  paymentMethod: z.enum(["pix", "card", "boleto", "crypto"]).optional(), origin: z.enum(["progressive", "advanced_rule", "accepted_offer"]),
  settingsHash: hash, stageEventIds: z.array(ref).max(10000).refine(ids => new Set(ids).size === ids.length),
  basis: z.strictObject({ items: z.array(basisItem).min(1).max(200), originalSubtotalCents: nonnegativeCents,
    merchandiseSubtotalCents: nonnegativeCents, promotionDiscountCents: nonnegativeCents }), discountCents: cents,
  ruleId: ref.optional(), offer: z.strictObject({ authorizedOfferId: ref, acceptedOfferRowId: ref, termsHash: hash }).optional(),
}).superRefine((value, ctx) => {
  const original = value.basis.items.reduce((sum, item) => sum + BigInt(item.baseUnitPriceCents) * BigInt(item.quantity), 0n);
  const effective = value.basis.items.reduce((sum, item) => sum + BigInt(item.unitPriceCents) * BigInt(item.quantity), 0n);
  if (original !== BigInt(value.basis.originalSubtotalCents) || effective !== BigInt(value.basis.merchandiseSubtotalCents)
    || original - effective !== BigInt(value.basis.promotionDiscountCents) || BigInt(value.discountCents) > effective
    || value.basis.items.some(item => item.unitPriceCents > item.baseUnitPriceCents)
    || new Set(value.basis.items.map(item => JSON.stringify([item.variantId, [...item.optionItemIds].sort()]))).size !== value.basis.items.length
    || (value.origin === "accepted_offer") !== (value.offer !== undefined)
    || value.origin !== "accepted_offer" && (value.stageEventIds.length === 0 || value.paymentMethod === undefined))
    ctx.addIssue({ code: "custom", message: "normal_benefit_authorization_inconsistent" });
});
export type NormalCommercialBenefitAuthorization = z.infer<typeof normalCommercialBenefitAuthorizationSchema>;
export const normalCheckoutBenefitsCommandSchema = z.strictObject({ expectedVersion: z.number().int().min(0).max(2_147_483_646),
  method: z.enum(["pix", "card", "boleto", "crypto"]) });
export const normalCheckoutOfferCommandSchema = z.strictObject({ expectedVersion: z.number().int().min(0).max(2_147_483_646), offerId: ref });
export type NormalCheckoutBenefitsCommand = z.infer<typeof normalCheckoutBenefitsCommandSchema>;
export type NormalCheckoutOfferCommand = z.infer<typeof normalCheckoutOfferCommandSchema>;
export type NormalCheckoutPolicyDiscountOwner = z.infer<typeof normalCheckoutPolicyDiscountOwnerSchema>;
export type NormalCheckoutAcceptedOfferDiscountOwner = z.infer<typeof normalCheckoutAcceptedOfferDiscountOwnerSchema>;
