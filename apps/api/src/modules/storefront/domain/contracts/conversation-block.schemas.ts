import { z } from "zod";
import { commercialNoticesSchema } from "./commercial-notice.schemas.js";

const id = z.string().min(1).max(191);
const text = z.string().max(24000);
const money = z.number().nonnegative();
const count = z.number().int().nonnegative();
const rating = z.number().min(0).max(5);
const percent = z.number().min(0).max(100);
const list = <T extends z.ZodType>(item: T) => z.array(item).max(200);
const notice = z.strictObject({ ruleId: id.optional(), message: text });
const serviceSlot = z.strictObject({ slotId: id, date: z.string().max(10), startTime: z.string().max(5),
  startsAt: z.string().max(40), endsAt: z.string().max(40), timeZone: z.string().max(80),
  durationMinutes: z.number().int().positive(), selectable: z.boolean() });

const product = z.strictObject({
  id, name: text, description: text.optional(), price: money, priceFormatted: text, inStock: z.boolean(),
  ruleNotices: list(notice).optional(), image: text.optional(), images: list(text).optional(),
  variants: list(z.strictObject({ id, name: text, value: text, price: money.optional(),
    priceFormatted: text.optional(), stock: count.optional(), sku: text.optional() })).optional(),
  rating: rating.optional(), reviewCount: count.optional(), originalPrice: money.optional(),
  originalPriceFormatted: text.optional(), discountPercent: percent.optional(), stock: count.optional(), sku: text.optional(),
  source: z.enum(["local", "marketplace"]).optional(), sellerName: text.optional(), sellerMerchantId: id.optional(),
  detailed: z.boolean().optional(), productType: z.enum(["physical", "digital", "service", "food"]).optional(),
  serviceSchedule: z.strictObject({ timeZone: z.string().max(80), durationMinutes: z.number().int().positive(), slots: list(serviceSlot) }).optional(),
  optionGroups: list(z.strictObject({ id, name: text, required: z.boolean(), selectionType: z.enum(["single", "multiple"]),
    items: list(z.strictObject({ id, name: text, priceModifierInCents: z.number().int() })) })).optional(),
});
const cartItem = z.strictObject({ variantId: id, productName: text, quantity: z.number().int().positive(),
  optionItemIds: z.array(id).max(250).optional(), serviceSlotId: id.nullable().optional(), selectionLabel: text.optional(),
  price: money, subtotal: money, imageUrl: text.optional(), selectedServiceSlotId: id.optional(),
  selectedOptions: z.array(z.strictObject({ itemId: id.optional(), groupName: text, itemName: text, priceModifier: z.number() })).max(250).optional() });
const block = <T extends string, S extends z.ZodRawShape>(type: T, data: S) =>
  z.strictObject({ type: z.literal(type), data: z.strictObject(data) });

/** Exhaustive display contracts: no catch-all block or untyped data payload. */
export const conversationBlockSchema = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("product_card"), data: product }),
  block("product_carousel", { products: list(product), nextCursor: text.optional(), merchantId: id.optional(), query: text.optional(), categoryId: id.optional() }),
  block("comparison_table", { products: list(z.strictObject({ id, name: text, price: money,
    attributes: z.record(z.string(), text), stock: count, rating: rating.optional() })), attributes: list(text) }),
  block("cart_summary", { cartId: id.optional(), items: list(cartItem), itemCount: count, subtotal: money,
    discount: money.optional(), couponCode: text.nullable().optional(), freeShipping: z.boolean().optional(), total: money,
    nextNudge: z.strictObject({ kind: text, gap: z.number().optional(), message: text, reachable: z.boolean(), ruleId: id.optional() }).optional(),
    activeRules: list(notice).optional(), commercialNotices: commercialNoticesSchema.optional() }),
  block("cart_add_result", { cartId: id, variantId: id, serviceSlotId: id.optional(), optionItemIds: list(id).optional(),
    status: z.enum(["succeeded", "rejected", "unknown"]), code: text.optional() }),
  block("shipping_options", { options: list(z.strictObject({ carrier: text, name: text, price: money, priceFormatted: text, days: count })) }),
  block("quick_replies", { options: list(text) }),
  block("checkout_redirect", { url: text, sessionId: text }),
  block("checkout_prepared", { actionId: id, cartId: id, shippingPreference: z.enum(["fastest", "cheapest"]), paymentPreference: z.enum(["pix", "card"]) }),
  block("order_confirmation", { orderId: id, total: money,
    items: list(z.strictObject({ productName: text, quantity: z.number().int().positive(), price: money })), estimatedDelivery: text.optional() }),
  block("shipping_quote_input", { productName: text, productId: id }),
  block("variant_selector", { productId: id, productName: text,
    groups: list(z.strictObject({ name: text, options: list(z.strictObject({ id, value: text, available: z.boolean() })) })) }),
  block("product_comparison", { products: list(z.strictObject({ id, name: text, price: money, priceFormatted: text,
    rating: rating.optional(), inStock: z.boolean(), attributes: z.record(z.string(), text) })), missingProductNames: list(text).optional() }),
  block("wishlist", { items: list(product.pick({ id: true, name: true, description: true, price: true, priceFormatted: true,
    image: true, images: true, inStock: true, rating: true, reviewCount: true })) }),
  block("reviews", { productId: text, productName: text, averageRating: rating, totalReviews: count,
    reviews: list(z.strictObject({ id, author: text, rating, text, date: text })), nextCursor: text.optional() }),
  block("add_review", { productId: id, productName: text }),
  block("cross_sell", { trigger: text, displayMode: z.enum(["inline", "modal", "banner", "interstitial"]).optional(), products: list(z.strictObject({ id, productId: id.optional(), name: text, price: money,
    priceFormatted: text, image: text.optional(), images: list(text).optional(), inStock: z.boolean(),
    discountPercent: percent.optional(), promoId: id.optional(), couponCode: text.optional() })) }),
  block("coupon_list", { coupons: list(z.strictObject({ code: text, description: text, minCartValue: money.optional(),
    minCartValueFormatted: text.optional(), expiresAt: text.nullable() })),
    progressive: z.strictObject({ maxPercent: percent, description: text }).optional(), advancedRules: list(z.strictObject({ label: text })).optional() }),
  // Already produced by the server builder; previously missing from the TypeScript union.
  block("category_carousel", { categories: list(z.strictObject({ id, name: text, slug: text.optional(), productCount: count })) }),
]);

export type ValidatedConversationBlock = z.infer<typeof conversationBlockSchema>;

