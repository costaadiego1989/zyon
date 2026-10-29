import { z } from "zod";

// Wire validation only, never authentication or authorization of a write.
const id = z.string().min(1).max(191).refine(value => value.trim().length > 0 && !value.includes("\0")
  && !Array.from(value).some(character => { const point = character.codePointAt(0)!; return point >= 0xd800 && point <= 0xdfff; }));
const cents = z.number().int().min(0).max(2_147_483_647);
const quantity = z.number().int().min(1).max(99);
const optionIds = z.array(id).max(250).refine(ids => new Set(ids).size === ids.length);
const selectedOptions = z.array(z.strictObject({ groupId: id, groupName: z.string().min(1).max(200),
  itemId: id, itemName: z.string().min(1).max(200), priceModifierInCents: cents })).max(250)
  .refine(options => new Set(options.map(option => option.itemId)).size === options.length);
const identity = (line: { variantId: string; selectedOptionItemIds?: readonly string[]; selectedOptions?: readonly { itemId: string }[] }) =>
  JSON.stringify([line.variantId, [...(line.selectedOptionItemIds ?? line.selectedOptions?.map(option => option.itemId) ?? [])].sort()]);
const item = z.strictObject({ variantId: id, productId: id, sku: id, categoryId: id.optional(), quantity,
  baseUnitPriceCents: cents, unitPriceCents: cents, selectedOptions: selectedOptions.optional() });
const target = z.strictObject({ version: z.literal(1), promotionId: id, promotionUpdatedAt: z.iso.datetime({ offset: true }),
  acceptedQuantity: quantity, originalUnitPriceCents: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  maximumUnitPriceCents: cents, selectedOptionItemIds: optionIds.optional(), variantId: id, productId: id, sku: id,
  source: z.enum(["product", "cross_sell"]) }).refine(value => value.maximumUnitPriceCents <= value.originalUnitPriceCents);
const pricingShape = { kind: z.literal("quote_candidate"), version: z.literal(1), merchantId: id,
  items: z.array(item).min(1).max(200), originalSubtotalCents: cents, preservedSavingsCents: cents,
  allocatedSavingsCents: cents, promotionDiscountCents: cents, cartDiscountCents: cents,
  merchandiseSubtotalCents: cents, payableMerchandiseCents: cents, remainingDiscountCents: cents,
  notice: z.enum(["discount_limit_reached", "discount_limited"]).optional() };
type Totals = { items: z.infer<typeof item>[]; originalSubtotalCents: number; merchandiseSubtotalCents: number;
  promotionDiscountCents: number; preservedSavingsCents: number; allocatedSavingsCents: number;
  cartDiscountCents: number; payableMerchandiseCents: number };
function validTotals(value: Totals): boolean {
  const original = value.items.reduce((sum, line) => sum + BigInt(line.baseUnitPriceCents) * BigInt(line.quantity), 0n);
  const effective = value.items.reduce((sum, line) => sum + BigInt(line.unitPriceCents) * BigInt(line.quantity), 0n);
  return original === BigInt(value.originalSubtotalCents) && effective === BigInt(value.merchandiseSubtotalCents)
    && original - effective === BigInt(value.promotionDiscountCents)
    && BigInt(value.preservedSavingsCents) + BigInt(value.allocatedSavingsCents) === BigInt(value.promotionDiscountCents)
    && effective - BigInt(value.cartDiscountCents) === BigInt(value.payableMerchandiseCents)
    && new Set(value.items.map(identity)).size === value.items.length
    && value.items.every(line => line.unitPriceCents <= line.baseUnitPriceCents);
}
export const normalCheckoutCrossSellPricingQuoteSchema = z.strictObject({ ...pricingShape, target }).superRefine((value, ctx) => {
  const targets = value.items.filter(line => identity(line) === identity(value.target));
  if (!validTotals(value) || targets.length !== 1 || targets[0]!.productId !== value.target.productId
    || targets[0]!.sku !== value.target.sku || targets[0]!.quantity !== value.target.acceptedQuantity
    || targets[0]!.baseUnitPriceCents !== value.target.originalUnitPriceCents
    || targets[0]!.unitPriceCents !== value.target.maximumUnitPriceCents
    || value.target.maximumUnitPriceCents >= value.target.originalUnitPriceCents)
    ctx.addIssue({ code: "custom", message: "normal_checkout_cross_sell_pricing_inconsistent" });
});
export const normalCheckoutCrossSellBatchPricingQuoteSchema = z.strictObject({ ...pricingShape,
  // Empty is an internal, zero-money cart-removal projection. A public quote
  // still requires a real target and its corresponding line below.
  items: z.array(item).max(200), targets: z.array(target).max(200) })
  .superRefine((value, ctx) => {
    const { targets, ...common } = value;
    if (!validTotals(value) || new Set(targets.map(identity)).size !== targets.length
      || targets.some(target => !normalCheckoutCrossSellPricingQuoteSchema.safeParse({ ...common, target }).success))
      ctx.addIssue({ code: "custom", message: "normal_checkout_cross_sell_batch_inconsistent" });
  });
const sha256 = z.string().regex(/^[a-f0-9]{64}$/);
const version = z.number().int().min(0).max(2_147_483_646);
export const normalCheckoutCrossSellScopeSchema = z.strictObject({ merchantId: id, sessionId: id });
export const normalCheckoutCrossSellTargetSelectionSchema = z.strictObject({ sku: id, variant_id: id, quantity,
  selected_option_item_ids: optionIds.optional() });
export const normalCheckoutCrossSellQuoteRequestSchema = z.strictObject({ suggestion_id: id,
  targets: z.array(normalCheckoutCrossSellTargetSelectionSchema).min(1).max(200)
    .refine(targets => new Set(targets.map(target => JSON.stringify([target.variant_id,
      [...(target.selected_option_item_ids ?? [])].sort()]))).size === targets.length) });
export const normalCheckoutCrossSellQuoteSchema = z.strictObject({ version: z.literal(1), merchantId: id, sessionId: id,
  suggestionId: id, sessionVersion: version, contextHash: sha256, basisHash: sha256,
  pricing: normalCheckoutCrossSellBatchPricingQuoteSchema,
}).refine(value => value.pricing.merchantId === value.merchantId && value.pricing.targets.length > 0);
export const normalCheckoutCrossSellAcceptanceSchema = z.strictObject({ suggestion_id: id,
  accepted_skus: z.array(id).min(1).max(200).refine(skus => new Set(skus).size === skus.length),
  expected_quote: normalCheckoutCrossSellQuoteSchema,
}).refine(value => value.suggestion_id === value.expected_quote.suggestionId
  && JSON.stringify([...value.accepted_skus].sort()) === JSON.stringify([...new Set(value.expected_quote.pricing.targets.map(target => target.sku))].sort()));
export const normalCheckoutCrossSellAcknowledgementSchema = z.strictObject({ version: z.literal(1), status: z.literal("accepted"),
  merchantId: id, sessionId: id, suggestionId: id, persistenceVersion: z.number().int().min(1).max(2_147_483_647), quoteHash: sha256 });
export const normalCheckoutCrossSellHttpQuoteSchema = normalCheckoutCrossSellQuoteRequestSchema.extend({ session_id: id });
export const normalCheckoutCrossSellHttpAcceptanceSchema = normalCheckoutCrossSellAcceptanceSchema.safeExtend({ session_id: id })
  .refine(value => value.session_id === value.expected_quote.sessionId);
const amount = z.number().finite().min(0).max(21_474_836.47)
  .refine(value => Math.abs(value * 100 - Math.round(value * 100)) < 0.0000001);
export const normalCheckoutProductTypeSchema=z.enum(["physical","food","digital","service"]);
export const normalCheckoutFulfillmentStrategySchema=z.enum(["carrier","pickup","local_delivery","digital","service"]);
export type NormalCheckoutProductType=z.infer<typeof normalCheckoutProductTypeSchema>;
export type NormalCheckoutFulfillmentStrategy=z.infer<typeof normalCheckoutFulfillmentStrategySchema>;
const fulfillmentFields={productType:normalCheckoutProductTypeSchema.optional(),fulfillmentStrategy:normalCheckoutFulfillmentStrategySchema.optional()};
const coherentFulfillment=(line:{productType?:NormalCheckoutProductType;fulfillmentStrategy?:NormalCheckoutFulfillmentStrategy})=>
  line.productType===undefined&&line.fulfillmentStrategy===undefined
  ||line.productType==="digital"&&line.fulfillmentStrategy==="digital"
  ||line.productType==="service"&&line.fulfillmentStrategy==="service"
  ||(line.productType==="physical"||line.productType==="food")
    &&(line.fulfillmentStrategy==="carrier"||line.fulfillmentStrategy==="pickup"||line.fulfillmentStrategy==="local_delivery");
const projectionItem = z.object({ sku: id, name: z.string().min(1), quantity, unit_price: amount,...fulfillmentFields,
  original_unit_price: amount.optional(), variant: z.string().optional(), variant_label: z.string().optional(), image_url: z.string().optional() }).passthrough()
  .refine(coherentFulfillment,{message:"normal_checkout_fulfillment_inconsistent"});
const projectionCartItem = z.object({ sku: id, name: z.string().min(1), variantId: id, product_id: id, quantity,
  price: amount, originalPrice: amount.optional(), variant: z.string().optional(),...fulfillmentFields }).passthrough()
  .refine(coherentFulfillment,{message:"normal_checkout_fulfillment_inconsistent"});
const projectionExperience = z.object({ items: z.array(projectionItem).min(1).max(200), totals: z.object({
  subtotal: amount, discount: amount, shipping: amount.optional(), service_fee: amount.optional(), total: amount, total_to_pay: amount.optional(),
}).passthrough() }).passthrough();
const projectionCart = z.object({ currency: z.literal("BRL"), items: z.array(projectionCartItem).min(1).max(200),
  total: amount, currentDiscount: amount.optional() }).passthrough();
export const normalCheckoutCrossSellHttpAcceptanceResponseSchema = z.discriminatedUnion("projection_status", [
  z.strictObject({ acknowledgement: normalCheckoutCrossSellAcknowledgementSchema, projection_status: z.literal("available"),
    experience: projectionExperience, cart: projectionCart,
    agent_turn: z.object({ role: z.literal("agent"), text: z.string().min(1).max(4000), occurredAt: z.string().optional() }).optional(),
    suggestion: z.unknown().optional() }),
  z.strictObject({ acknowledgement: normalCheckoutCrossSellAcknowledgementSchema, projection_status: z.literal("requires_review") }),
]).superRefine((value, ctx) => {
  if (value.projection_status !== "available") return;
  const cents = (value: number) => Math.round(value * 100), { cart, experience } = value, totals = experience.totals;
  const cartTotal = cart.items.reduce((sum, item) => sum + BigInt(cents(item.price)) * BigInt(item.quantity), 0n);
  const projectedTotal = experience.items.reduce((sum, item) => sum + BigInt(cents(item.unit_price)) * BigInt(item.quantity), 0n);
  const key = (sku: string, quantity: number, price: number, variant?: string) => JSON.stringify([sku, quantity, cents(price), variant ?? null]);
  if (cartTotal !== BigInt(cents(cart.total)) || projectedTotal !== cartTotal || cents(totals.subtotal) !== cents(cart.total)
    || cents(totals.discount) !== cents(cart.currentDiscount ?? 0)
    || cents(totals.total) !== cents(totals.subtotal) - cents(totals.discount) + cents(totals.shipping ?? 0)
    || totals.total_to_pay !== undefined && cents(totals.total_to_pay) !== cents(totals.total) + cents(totals.service_fee ?? 0)
    || JSON.stringify(cart.items.map(item => key(item.sku, item.quantity, item.price, item.variant)).sort())
      !== JSON.stringify(experience.items.map(item => key(item.sku, item.quantity, item.unit_price, item.variant)).sort()))
    ctx.addIssue({ code: "custom", message: "normal_checkout_cross_sell_projection_inconsistent" });
});
export type NormalCheckoutCrossSellHttpAcceptanceResponse = z.infer<typeof normalCheckoutCrossSellHttpAcceptanceResponseSchema>;
export type NormalCheckoutCrossSellScope = z.infer<typeof normalCheckoutCrossSellScopeSchema>;
export type NormalCheckoutCrossSellQuoteRequest = z.infer<typeof normalCheckoutCrossSellQuoteRequestSchema>;
export type NormalCheckoutCrossSellTargetSelection = z.infer<typeof normalCheckoutCrossSellTargetSelectionSchema>;
export type NormalCheckoutCrossSellQuote = z.infer<typeof normalCheckoutCrossSellQuoteSchema>;
export type NormalCheckoutCrossSellAcceptance = z.infer<typeof normalCheckoutCrossSellAcceptanceSchema>;
export type NormalCheckoutCrossSellAcknowledgement = z.infer<typeof normalCheckoutCrossSellAcknowledgementSchema>;
export type NormalCheckoutCrossSellPricingQuote = z.infer<typeof normalCheckoutCrossSellPricingQuoteSchema>;
export type NormalCheckoutCrossSellBatchPricingQuote = z.infer<typeof normalCheckoutCrossSellBatchPricingQuoteSchema>;
