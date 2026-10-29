import { z } from "zod";
import { storefrontToolArgumentSchemas as tools } from "./storefront-tool.schemas.js";

const empty = z.strictObject({});
const action = <T extends string, S extends z.ZodType>(tool: T, args: S) => z.strictObject({ tool: z.literal(tool), args });

/** UI actions are server-resolved selections, not arbitrary native tool access.
 * Cart and merchant bindings are deliberately absent from their argument schemas.
 */
export const storefrontUiActionSchema = z.discriminatedUnion("tool", [
  action("add_catalog_items", z.strictObject({ lines: z.array(tools.add_item_to_cart.pick({ variantId: true, quantity: true })).min(1).max(30) })),
  action("get_product_details", tools.get_product_details),
  action("search_products", tools.search_products.pick({ query: true, categoryId: true, cursor: true, criteria: true }).extend({ query: tools.search_products.shape.query.default("*") })),
  action("list_categories", empty),
  action("get_reviews", tools.get_reviews.pick({ productId: true, cursor: true, filter: true })),
  action("get_product_questions", tools.get_product_questions),
  action("ask_product_question", tools.get_product_details),
  action("create_question", tools.create_question.omit({ authorName: true })),
  action("get_similar_products", tools.get_similar_products.pick({ productId: true })),
  action("compare_products", tools.get_product_details),
  action("get_daily_deals", empty),
  action("add_item_to_cart", tools.add_item_to_cart.omit({ cartId: true }).extend({ quantity: tools.add_item_to_cart.shape.quantity.default(1) })),
  action("get_cart", empty), action("get_wishlist", z.strictObject({ share: z.boolean().optional() })),
  action("add_to_wishlist", tools.add_to_wishlist), action("remove_from_wishlist", tools.remove_from_wishlist),
  action("remove_cart_item", tools.remove_cart_item.omit({ cartId: true })),
  action("update_cart_item", tools.update_cart_item.omit({ cartId: true })),
  action("apply_coupon", tools.apply_coupon.omit({ cartId: true })),
  action("create_checkout_session", empty),
]);

