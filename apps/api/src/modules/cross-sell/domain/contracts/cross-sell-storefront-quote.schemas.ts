import { z } from "zod";
import { crossSellIntentV1Schema } from "./cross-sell-quote.schemas.js";
import { storefrontLocalCartCommercialOutcomeV1Schema, storefrontSelectedOptionsSchema, storefrontOptionItemIdsSchema,
  storefrontOptionLineIdentity } from "../../../storefront/domain/contracts/storefront-claimed-cart-effect.schemas.js";

const id = crossSellIntentV1Schema.shape.promotionId;
const cents = z.number().int().min(0).max(2_147_483_647);
const quantity = z.number().int().min(1).max(99);
/** Persisted SERVER intent, not an executable command, quote or capability. */
export const crossSellAcceptedLineIntentSchema = crossSellIntentV1Schema.extend({ maximumUnitPriceCents: cents,
  selectedOptionItemIds: storefrontOptionItemIdsSchema.optional() })
  .refine(value => value.maximumUnitPriceCents <= value.originalUnitPriceCents);
export type CrossSellAcceptedLineIntent = z.infer<typeof crossSellAcceptedLineIntentSchema>;
export const crossSellStorefrontBasisItemSchema = z.strictObject({ variantId: id, productId: id, sku: id,
  name: z.string().min(1).max(1000), categoryId: id.optional(), quantity, unitPriceCents: cents,
  imageUrl: z.string().min(1).max(2048).optional(), selectedOptions: storefrontSelectedOptionsSchema.optional(),
  crossSellIntent: crossSellAcceptedLineIntentSchema.optional(),
});
export const crossSellStorefrontCartBasisSchema = z.strictObject({ items: z.array(crossSellStorefrontBasisItemSchema).max(200),
  total: cents, discount: cents, couponCode: z.null(), freeShipping: z.literal(false),
}).refine(value => new Set(value.items.map(storefrontOptionLineIdentity)).size === value.items.length
  && value.items.reduce((sum, item) => sum + BigInt(item.unitPriceCents) * BigInt(item.quantity), 0n) === BigInt(value.total));
export const crossSellStorefrontQuoteRequestSchema = z.strictObject({ variantId: id, promotionId: id, quantity,
  selectedOptionItemIds: storefrontOptionItemIdsSchema.optional() });
/** Visible, bounded preconditions only. Acceptance always reloads authority. */
export const crossSellStorefrontQuoteSchema = z.strictObject({ version: z.literal(1), merchantId: id, cartId: id,
  variantId: id, productId: id, sku: id, promotionId: id,
  promotionUpdatedAt: crossSellIntentV1Schema.shape.promotionUpdatedAt,
  quantity, originalUnitPriceCents: cents, maximumUnitPriceCents: cents,
  selectedOptionItemIds: storefrontOptionItemIdsSchema.optional(), selectedOptions: storefrontSelectedOptionsSchema.optional(),
  cartBasis: crossSellStorefrontCartBasisSchema,
  quote: storefrontLocalCartCommercialOutcomeV1Schema.shape.quote,
}).superRefine((value, ctx) => {
  const target = value.quote.items.find(item => item.variantId === value.variantId);
  const validMoney = storefrontLocalCartCommercialOutcomeV1Schema.safeParse({ version: 1, freeShipping: false,
    discountCents: value.quote.subtotalCents - value.quote.merchandiseTotalCents, quote: value.quote }).success;
  if (!validMoney || !target || storefrontOptionLineIdentity(value) !== storefrontOptionLineIdentity({ variantId: value.variantId, selectedOptions: value.selectedOptions })
    || storefrontOptionLineIdentity(value) !== storefrontOptionLineIdentity(target)
    || value.cartBasis.items.length >= 200 || value.maximumUnitPriceCents > value.originalUnitPriceCents
    || target.productId !== value.productId || target.quantity !== value.quantity
    || target.baseUnitPriceCents !== value.originalUnitPriceCents || target.unitPriceCents !== value.maximumUnitPriceCents
    || value.cartBasis.items.some(item => item.variantId === value.variantId)
    || value.quote.items.length !== value.cartBasis.items.length + 1
    || value.cartBasis.items.some(item => !value.quote.items.some(line => storefrontOptionLineIdentity(line) === storefrontOptionLineIdentity(item)
      && line.productId === item.productId && line.quantity === item.quantity && line.baseUnitPriceCents === item.unitPriceCents))) {
    ctx.addIssue({ code: "custom", message: "cross_sell_quote_inconsistent" });
  }
});
export const crossSellStorefrontAcceptanceSchema = z.strictObject({ expectedQuote: crossSellStorefrontQuoteSchema });
export const crossSellStorefrontAcknowledgementSchema = z.strictObject({ version: z.literal(1), status: z.literal("accepted"), merchantId: id, cartId: id });
export type CrossSellStorefrontAcknowledgement = z.infer<typeof crossSellStorefrontAcknowledgementSchema>;
export type CrossSellStorefrontQuoteRequest = z.infer<typeof crossSellStorefrontQuoteRequestSchema>;
export type CrossSellStorefrontQuote = z.infer<typeof crossSellStorefrontQuoteSchema>;
export type CrossSellStorefrontAcceptance = z.infer<typeof crossSellStorefrontAcceptanceSchema>;

