import { z } from "zod";
import type { StorefrontToolName } from "./storefront-tool.schemas.js";
import type { ToolResult } from "../tools/types.js";
import { commercialNoticesSchema } from "./commercial-notice.schemas.js";
import { storefrontShippingReferenceResultSchema } from "./storefront-shipping-reference.schemas.js";

export const STOREFRONT_TOOL_OUTPUT_VERSION = 1;
const id = z.string().min(1).max(191);
const text = z.string().max(24000);
const money = z.number().nonnegative();
const count = z.number().int().nonnegative();
const percent = z.number().min(0).max(100);
const rating = z.number().min(0).max(5);
const list = <T extends z.ZodType>(item: T) => z.array(item).max(200);
// Output objects deliberately project documented fields, unlike strict inputs.
// Repository entities may contain costs/secrets; unknown fields never cross this boundary.
const media = z.object({ id: id.optional(), url: text, type: z.enum(["IMAGE", "VIDEO"]).optional(), alt: text.optional(), order: count.optional() });
const variant = z.object({ id, sku: text.optional(), attributes: z.record(z.string(), text).optional(),
  basePriceInCents: money.optional(), price: money.optional(), stockQuantity: count.optional(), stockReserved: count.optional(),
  isActive: z.boolean().optional(), media: list(media).optional() });
const slot = z.object({ slotId: id, date: z.string().max(10), startTime: z.string().max(5), startsAt: z.string().max(40),
  endsAt: z.string().max(40), timeZone: z.string().max(80), durationMinutes: z.number().int().positive() });
const notice = z.object({ ruleId: id.optional(), message: text });
const optionGroup = z.object({ id, name: text, required: z.boolean(), selectionType: z.enum(["single", "multiple"]),
  items: list(z.object({ id, name: text, priceModifierInCents: z.number().int() })) });
const product = z.object({ id, name: text, description: text.nullable().optional(), price: money.optional(), priceFormatted: text.optional(),
  type: z.enum(["physical", "digital", "service", "food"]).optional(),
  inStock: z.boolean().optional(), image: text.nullable().optional(), images: list(text).optional(), media: list(media).optional(),
  variants: list(variant).optional(), optionGroups: list(optionGroup).optional(), ruleNotices: list(notice).optional(),
  stock: count.nullable().optional(), rating: rating.nullable().optional(), reviewCount: count.optional(),
  originalPrice: money.optional(), discountPercent: percent.optional(), coupon: z.boolean().optional(),
  source: z.enum(["local", "marketplace"]).optional(), sellerName: text.optional(), sellerMerchantId: id.optional(),
  serviceSchedule: z.object({ timeZone: text, durationMinutes: z.number().int().positive(), slots: list(slot.extend({ selectable: z.boolean() })) }).optional() });
const suggestion = z.object({ name: text, sku: id, productId: id, price: money, imageUrl: text.optional(),
  discountPercent: percent.optional(), couponCode: text.optional(), promoId: id.optional() });
const suggestions = { crossSellSuggestions: list(suggestion).optional(), crossSellDisplayMode: text.optional() };
const pricedProduct = product.extend({ price: money, inStock: z.boolean() });
const cartItem = z.object({ variantId: id, name: text, quantity: z.number().int().positive(), unitPrice: money, lineTotal: money,
  optionItemIds: z.array(id).max(250).optional(), serviceSlotId: id.nullable().optional(), selectionLabel: text.optional(),
  imageUrl: text.optional(), originalPrice: money.optional(), discountPercent: percent.optional(), coupon: z.boolean().optional(),
  selectedServiceSlot: slot.optional(), selectedOptions: z.array(z.object({ itemId: id.optional(), groupName: text, itemName: text, priceModifier: z.number() })).max(250).optional() });
const cart = z.object({ cartId: id, items: list(cartItem), total: money, itemCount: count, commercialNotices: commercialNoticesSchema.optional(),
  discount: money.optional(), freeShipping: z.boolean().optional(), couponCode: text.nullable().optional(),
  nextNudge: z.object({ kind: z.enum(["cart_total", "cart_item_count", "conditional", "progressive"]), gap: z.number().optional(),
    message: text, reachable: z.boolean(), ruleId: id.optional() }).nullable().optional(), activeRules: list(notice).optional() });
const coupon = z.object({ code: text, type: text, value: money, description: text, minCartValue: money.optional(), expiresAt: text.nullable() });
const review = z.object({ id, author: text, rating, text, date: text });
const policies = z.object({ privacy: text.optional(), terms: text.optional(), returns: text.optional(), exchanges: text.optional(),
  shipping: text.optional(), warranty: text.optional(), payment: text.optional(), general: text.optional() });
const url = z.string().max(2048).refine(value => {
  try { const parsed = new URL(value); return ["http:", "https:"].includes(parsed.protocol) && !parsed.username && !parsed.password; }
  catch { return false; }
});
const legacyShippingOutput = z.object({ options: list(z.object({ carrier: text, name: text, price: money, days: count, zipCode: text.optional() })) });
const shippingOutput = z.unknown().transform((raw, ctx) => {
  try {
    // Decide BEFORE projection: corrupt reference metadata must not be stripped
    // into a successful legacy options object by the compatibility branch.
    const reference = raw !== null && typeof raw === "object" && "referenceOnly" in raw;
    const parsed = (reference ? storefrontShippingReferenceResultSchema : legacyShippingOutput).safeParse(raw);
    if (parsed.success) return parsed.data;
  } catch { /* Fixed validation failure; never expose caller/provider input. */ }
  ctx.addIssue({ code: "custom", message: "shipping_reference_invalid" });
  return z.NEVER;
});

/** Success payloads for every native tool. No unknown/passthrough result schema. */
export const storefrontToolOutputSchemas = {
  search_products: z.object({ products: list(pricedProduct), nextCursor: text.nullable().optional(), query: text.optional(), categoryId: id.optional(),
    source: z.enum(["mixed", "marketplace", "local"]).optional(), note: text.optional() }),
  get_product_details: z.object({ product: product.refine(value => value.price !== undefined
    || value.variants?.some(item => item.isActive !== false && item.basePriceInCents !== undefined)), ...suggestions }),
  compare_products: z.object({ comparison: list(z.object({ id, name: text, price: money, attributes: z.record(z.string(), text),
    stock: count.optional(), rating: rating.nullable().optional(), type: text.optional(), inStock: z.boolean().optional() })),
    requestedProductNames: list(text).optional(), missingProductNames: list(text).optional(), requiresProductNames: z.boolean().optional() }),
  get_product_availability: z.object({ inStock: z.boolean(), quantity: count.nullable(), estimatedShipping: text.optional() }),
  add_item_to_cart: cart.extend({ ...suggestions, addedItem: z.object({ variantId: id, serviceSlotId: id.optional(), optionItemIds: list(id) }).optional() }),
  get_cart: cart, remove_cart_item: cart, update_cart_item: cart, clear_cart: cart,
  quote_shipping: shippingOutput,
  apply_coupon: z.discriminatedUnion("applied", [
    z.object({ applied: z.literal(false), reason: text, commercialNotices: commercialNoticesSchema.optional() }),
    cart.extend({ applied: z.literal(true), couponCode: text, discountCents: count, discount: money, newTotal: money, reason: text }),
  ]),
  list_promotions: z.object({ promotions: list(coupon), coupons: list(coupon),
    progressive: z.object({ maxPercent: percent, description: text }).optional(), advancedRules: list(z.object({ label: text })).optional() }),
  remove_coupon: z.object({ cartId: id, total: money, discount: money, couponCode: z.null(), commercialNotices: commercialNoticesSchema.optional() }),
  list_categories: z.object({ categories: list(z.object({ id, name: text, slug: text.optional(), productCount: count })) }),
  create_checkout_session: z.union([
    z.object({ checkoutUrl: url, sessionId: id }),
    z.object({ budgetRequired: z.literal(true), cartId: id, message: text }),
    z.object({ checkoutPrepared: z.literal(true), actionId: id, cartId: id,
      shippingPreference: z.enum(["fastest", "cheapest"]), paymentPreference: z.enum(["pix", "card"]) }),
  ]),
  get_reviews: z.object({ reviews: list(review), productId: id.optional(), productName: text.optional(), nextCursor: text.optional(), totalCount: count, averageRating: rating }),
  create_review: review.extend({ productId: id, status: z.literal("pending_moderation") }),
  get_product_questions: z.object({ questions: list(z.object({ id, question: text, answer: text })), totalCount: count }),
  create_question: z.object({ id, productId: id, question: text, author: text, date: text, status: z.literal("awaiting_answer") }),
  get_similar_products: z.object({ products: list(pricedProduct) }),
  add_to_wishlist: z.object({ added: z.literal(true), productId: id, items: list(pricedProduct), message: text }),
  get_wishlist: z.object({ items: list(pricedProduct), message: text }),
  remove_from_wishlist: z.object({ removed: z.literal(true), productId: id, items: list(pricedProduct), message: text }),
  track_order: z.discriminatedUnion("found", [
    z.object({ found: z.literal(false), orderId: id.optional(), requiresIdentification: z.boolean().optional(), message: text }),
    z.object({ found: z.literal(true), orderId: id, status: text, statusLabel: text, trackingAvailable: z.boolean(),
      trackingCode: text.nullable().optional(), trackingUrl: text.optional(), carrier: text.nullable().optional(),
      estimatedDelivery: text.optional(), deliveredAt: text.optional(), completedAt: text.optional(), lastUpdate: text.optional(),
      lastUpdatedAt: text.optional(), message: text.optional() }),
  ]),
  get_store_policies: z.union([
    z.object({ configured: z.literal(true), policy: text }),
    z.object({ configured: z.literal(false), policy: z.null(), message: text }),
    z.object({ configured: z.boolean(), policies, message: text.optional() }),
  ]),
  get_buyer_profile: z.object({ message: text }),
  get_daily_deals: z.object({ deals: list(pricedProduct) }),
  get_faq: z.object({ faqs: list(z.object({ question: text, answer: text })) }),
  escalate_to_human: z.object({ escalated: z.literal(true), ticketId: id, message: text, reason: text.optional() }),
  get_invoice: z.object({ orderId: id.optional(), invoiceAvailable: z.literal(false), message: text }),
  cancel_order: z.object({ orderId: id.optional(), cancellationAvailable: z.literal(false), status: z.literal("unavailable").optional(), message: text }),
} satisfies Record<StorefrontToolName, z.ZodType>;

const errorSchema = z.object({ error: z.string().min(1).max(2000), detail: text.optional(), message: text.optional(),
  requiresIdentification: z.boolean().optional(), commercialNotices: commercialNoticesSchema.optional() });
const selection = z.object({ productId: id, productName: text, variants: list(z.object({ id, label: text })) });
const invalid = (): ToolResult => ({ ok: false, error: "invalid_tool_output", code: "invalid_tool_output" });

export function validateStorefrontToolOutput(name: string, data: unknown, scope?: { cartId: string }): ToolResult {
  if (!Object.hasOwn(storefrontToolOutputSchemas, name)) return invalid();
  // Never strip a negative outcome marker and accidentally turn it into success.
  if (data && typeof data === "object" && (("success" in data && data.success === false) || ("ok" in data && data.ok === false))) return invalid();
  const schema = data && typeof data === "object" && Object.hasOwn(data, "error")
    ? name === "add_item_to_cart" ? errorSchema.extend({ variantSelection: selection.optional() })
      : ["add_to_wishlist", "remove_from_wishlist"].includes(name) ? errorSchema.extend({ items: list(product).optional() })
      : name === "get_reviews" ? errorSchema.extend({ reviews: list(review).optional() })
      : name === "get_product_availability" ? errorSchema.extend({ inStock: z.boolean().optional(), quantity: count.optional() })
      : name === "compare_products" ? errorSchema.extend({ comparison: z.array(z.never()).optional() }) : errorSchema
    : storefrontToolOutputSchemas[name as StorefrontToolName];
  const parsed = schema.safeParse(data);
  if (!parsed.success) return invalid();
  if (scope && "cartId" in parsed.data && parsed.data.cartId !== scope.cartId) return invalid();
  return { ok: true, data: parsed.data };
}

export class StorefrontToolOutputError extends Error {
  constructor() { super("invalid_tool_output"); }
}

