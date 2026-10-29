import { z } from "zod";
import { moneyCents } from "@zyon/rules-engine";
import { paymentCartFingerprint } from "../../checkout/domain/services/payment-cart-fingerprint.js";
import { checkoutExplicitAddressSchema } from "../../checkout/domain/services/checkout-explicit-address.schema.js";
import { commercialNoticesSchema } from "../../storefront/domain/contracts/commercial-notice.schemas.js";

const ref = z.string().min(1).max(200).refine(value => value.trim() === value && !/[\u0000-\u001f\u007f]/.test(value));
const cents = z.number().int().min(0).max(2_147_483_647), hash = z.string().regex(/^[a-f0-9]{64}$/);
const money = z.number().finite().nonnegative().refine(value => { const parsed = moneyCents(value); return parsed !== null && parsed <= 2_147_483_647; });
const line = z.strictObject({ sku: ref, variantId: ref, product_id: ref, name: z.string().min(1).max(1000), productType: z.literal("physical"),
  quantity: z.number().int().min(1).max(99), price: money, originalPrice: money.optional(), variant: z.string().min(1).max(65536),
  selected_options: z.array(z.strictObject({ group_name: z.string().max(1000), item_name: z.string().max(1000), price_modifier: money })).max(250).optional(),
  fulfillmentStrategy: z.enum(["carrier", "pickup", "local_delivery"]).optional(), imageUrl: z.string().max(2048).optional(), productUrl: z.string().max(2048).optional(),
});
const cart = z.strictObject({ currency: z.literal("BRL"), total: money, currentDiscount: z.literal(0), source: z.literal("checkout").optional(),
  items: z.array(line).min(1).max(200), discountBudget: z.strictObject({ version: z.literal(1), originalSubtotalCents: cents, promotionDiscountCents: cents }),
  commercialNotices: commercialNoticesSchema.optional(),
}).superRefine((value, ctx) => {
  const effective = value.items.reduce((sum, item) => sum + BigInt(moneyCents(item.price) ?? -1) * BigInt(item.quantity), 0n);
  const original = value.items.reduce((sum, item) => sum + BigInt(moneyCents(item.originalPrice ?? item.price) ?? -1) * BigInt(item.quantity), 0n);
  if (effective !== BigInt(moneyCents(value.total) ?? -1) || original !== BigInt(value.discountBudget.originalSubtotalCents)
    || original - effective !== BigInt(value.discountBudget.promotionDiscountCents)
    || value.items.some(item => item.originalPrice !== undefined && item.originalPrice < item.price)
    || new Set(value.items.map(item => JSON.stringify([item.variantId, item.variant]))).size !== value.items.length)
    ctx.addIssue({ code: "custom", message: "widget_payment_projection_inconsistent" });
});
export const widgetCheckoutFrozenProjectionSchema = z.strictObject({ globalUserId: ref, cart,
  shipping: z.strictObject({ customerPrice: money, carrier: z.string().min(1).max(300), method: z.string().min(1).max(300),
    deliveryDays: z.number().int().positive(), destinationZip: z.string().regex(/^\d{8}$/), region: z.string().length(2) }),
  customer: z.strictObject({ fullName: z.string().trim().min(1).max(200), email: z.email().max(254), cpf: z.string().regex(/^\d{11}$/),
    phone: z.string().regex(/^\d{10,15}$/), email_verified: z.literal(true), address_verified: z.literal(true), address: checkoutExplicitAddressSchema,
  }),
}).refine(value => value.shipping.destinationZip === value.customer.address.zip && value.shipping.region === value.customer.address.state);
const breakdown = z.strictObject({ version: z.literal(1), currency: z.literal("BRL"), cartFingerprint: hash,
  confirmedCartFingerprint: hash.optional(), itemsSubtotalCents: cents, discountCents: z.literal(0), shippingCents: cents,
  platformFeeCents: cents, totalCents: cents.positive(),
});
export const widgetCheckoutPaymentAuthoritySchema = z.strictObject({ version: z.literal(1), origin: z.literal("widget_checkout"),
  paymentId: ref, merchantId: ref, checkoutSessionId: ref, buyerId: ref, acceptanceEventId: ref,
  checkoutVersion: z.number().int().min(1).max(2_147_483_647), revisionEventId: ref.optional(), contextHash: hash, basisHash: hash,
  method: z.enum(["pix", "card", "boleto", "crypto"]), currency: z.literal("BRL"), amountCents: cents.positive(),
  admittedAt: z.iso.datetime({ offset: true }), amountBreakdown: breakdown, frozenProjection: widgetCheckoutFrozenProjectionSchema,
}).superRefine((value, ctx) => {
  const projection = value.frozenProjection, amounts = value.amountBreakdown;
  if (value.buyerId !== projection.globalUserId || amounts.cartFingerprint !== value.basisHash
    || paymentCartFingerprint(projection) !== value.basisHash || moneyCents(projection.cart.total) !== amounts.itemsSubtotalCents
    || moneyCents(projection.shipping.customerPrice) !== amounts.shippingCents || amounts.totalCents !== value.amountCents
    || BigInt(amounts.itemsSubtotalCents) + BigInt(amounts.shippingCents) + BigInt(amounts.platformFeeCents) !== BigInt(value.amountCents))
    ctx.addIssue({ code: "custom", message: "widget_payment_authority_inconsistent" });
});
export type WidgetCheckoutPaymentAuthority = z.infer<typeof widgetCheckoutPaymentAuthoritySchema>;

/** Strict detached identity only. Does not issue authority or prove storage.
 * Never expose raw Zod data/errors, buyer contact or a caller exception. */
export function parseWidgetCheckoutPaymentAuthority(raw: unknown): WidgetCheckoutPaymentAuthority {
  try { return widgetCheckoutPaymentAuthoritySchema.parse(raw); }
  catch { throw new Error("payment_widget_checkout_authority_conflict"); }
}
