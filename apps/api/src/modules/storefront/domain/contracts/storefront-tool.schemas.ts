import { z } from "zod";
import { storefrontCartLineSelectorShape } from "./storefront-cart-line-selector.schemas.js";

export const STOREFRONT_TOOL_CONTRACT_VERSION = 1;
const id = z.string().min(1).max(191);
const cartId = id.optional();
const cursor = z.string().max(2048).optional();
const product = z.strictObject({ productId: id });
const cart = z.strictObject({ cartId: id });
const variant = z.strictObject({ variantId: id });
const quantity = z.number().int().min(1).max(99);
const limit = z.number().int().min(1).max(100).optional();

/** Stable Zod schemas are the source of truth for runtime and advertised tool arguments.
 * These contracts validate structure; tenant ownership and buyer authorization stay in the backend.
 */
export const storefrontToolArgumentSchemas = {
  search_products: z.strictObject({
    query: z.string().max(1000), categoryId: id.optional(), cursor, maxPrice: z.number().nonnegative().optional(),
    inStockOnly: z.boolean().optional(), limit: z.number().int().min(1).max(20).optional(),
    sortBy: z.enum(["price_asc", "price_desc", "rating", "best_sellers", "newest", "discount"]).optional(),
  }),
  get_product_details: product,
  compare_products: z.strictObject({
    productIds: z.array(id).min(1).max(5).optional(), productId: id.optional(),
    productNames: z.array(z.string().min(1).max(500)).min(1).max(5).optional(),
    productName: z.string().min(1).max(500).optional(), includeSimilar: z.boolean().optional(),
  }),
  get_product_availability: variant,
  add_item_to_cart: z.strictObject({
    cartId, variantId: id, quantity,
    selectedOptionItemIds: z.array(id).max(100).optional(), selectedServiceSlotId: id.optional(), crossSellPromoId: id.optional(),
  }),
  get_cart: cart,
  remove_cart_item: z.strictObject({ cartId: id, variantId: id, ...storefrontCartLineSelectorShape }),
  update_cart_item: z.strictObject({ cartId: id, variantId: id, quantity: z.number().int().min(0).max(99), ...storefrontCartLineSelectorShape }),
  clear_cart: cart,
  quote_shipping: z.strictObject({ cartId, productId: id.optional(), zipCode: z.string().min(1).max(32) }),
  apply_coupon: z.strictObject({ cartId, couponCode: z.string().min(1).max(100) }),
  list_promotions: z.strictObject({ cartId }),
  remove_coupon: cart,
  list_categories: z.strictObject({}),
  create_checkout_session: cart,
  get_reviews: z.strictObject({ productId: id, filter: z.enum(["positive", "negative", "recent"]).optional(),
    limit: z.number().int().min(1).max(50).optional(), cursor }),
  create_review: z.strictObject({ productId: id, rating: z.number().int().min(1).max(5),
    text: z.string().min(1).max(4000), authorName: z.string().min(1).max(200), authorPhone: z.string().min(1).max(40) }),
  get_product_questions: z.strictObject({ productId: id, filter: z.enum(["answered", "unanswered", "mine"]).optional() }),
  create_question: z.strictObject({ productId: id, question: z.string().min(1).max(4000), authorName: z.string().min(1).max(200) }),
  get_similar_products: z.strictObject({ productId: id, limit }),
  add_to_wishlist: product,
  get_wishlist: z.strictObject({}),
  remove_from_wishlist: product,
  track_order: z.strictObject({ orderId: id }),
  get_store_policies: z.strictObject({ policyType: z.enum(["privacy", "terms", "returns", "exchanges", "shipping", "warranty", "payment", "general", "all"]).optional() }),
  get_buyer_profile: z.strictObject({}),
  get_daily_deals: z.strictObject({ limit }),
  get_faq: z.strictObject({ category: z.string().max(200).optional() }),
  escalate_to_human: z.strictObject({ reason: z.string().min(1).max(2000) }),
  get_invoice: z.strictObject({ orderId: id }),
  cancel_order: z.strictObject({ orderId: id, reason: z.string().max(2000).optional() }),
} as const;

export type StorefrontToolName = keyof typeof storefrontToolArgumentSchemas;
export function storefrontToolSchema(name: string): z.ZodType<Record<string, unknown>> | undefined {
  return Object.hasOwn(storefrontToolArgumentSchemas, name)
    ? storefrontToolArgumentSchemas[name as StorefrontToolName] : undefined;
}

