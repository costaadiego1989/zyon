export * from "./types.js";

import { SEARCH_PRODUCTS, createSearchProductsTool } from "./definitions/search-products.tool.js";
import { GET_PRODUCT_DETAILS, createGetProductDetailsTool } from "./definitions/get-product-details.tool.js";
import { COMPARE_PRODUCTS, createCompareProductsTool } from "./definitions/compare-products.tool.js";
import { GET_PRODUCT_AVAILABILITY, createGetProductAvailabilityTool } from "./definitions/get-product-availability.tool.js";
import { ADD_ITEM_TO_CART, createAddItemToCartTool } from "./definitions/add-item-to-cart.tool.js";
import { GET_CART, createGetCartTool } from "./definitions/get-cart.tool.js";
import { REMOVE_CART_ITEM, createRemoveCartItemTool } from "./definitions/remove-cart-item.tool.js";
import { UPDATE_CART_ITEM, createUpdateCartItemTool } from "./definitions/update-cart-item.tool.js";
import { CLEAR_CART, createClearCartTool } from "./definitions/clear-cart.tool.js";
import { QUOTE_SHIPPING, createQuoteShippingTool } from "./definitions/quote-shipping.tool.js";
import { APPLY_COUPON, createApplyCouponTool } from "./definitions/apply-coupon.tool.js";
import { LIST_PROMOTIONS, createListPromotionsTool } from "./definitions/list-promotions.tool.js";
import { REMOVE_COUPON, createRemoveCouponTool } from "./definitions/remove-coupon.tool.js";
import { LIST_CATEGORIES, createListCategoriesTool } from "./definitions/list-categories.tool.js";
import { CREATE_CHECKOUT_SESSION, createCreateCheckoutSessionTool } from "./definitions/create-checkout-session.tool.js";
import { GET_REVIEWS, createGetReviewsTool } from "./definitions/get-reviews.tool.js";
import { CREATE_REVIEW, createCreateReviewTool } from "./definitions/create-review.tool.js";
import { GET_PRODUCT_QUESTIONS, createGetProductQuestionsTool } from "./definitions/get-product-questions.tool.js";
import { CREATE_QUESTION, createCreateQuestionTool } from "./definitions/create-question.tool.js";
import { GET_SIMILAR_PRODUCTS, createGetSimilarProductsTool } from "./definitions/get-similar-products.tool.js";
import { ADD_TO_WISHLIST, createAddToWishlistTool } from "./definitions/add-to-wishlist.tool.js";
import { GET_WISHLIST, createGetWishlistTool } from "./definitions/get-wishlist.tool.js";
import { REMOVE_FROM_WISHLIST, createRemoveFromWishlistTool } from "./definitions/remove-from-wishlist.tool.js";
import { TRACK_ORDER, createTrackOrderTool } from "./definitions/track-order.tool.js";
import { GET_STORE_POLICIES, createGetStorePoliciesTool } from "./definitions/get-store-policies.tool.js";
import { GET_BUYER_PROFILE, createGetBuyerProfileTool } from "./definitions/get-buyer-profile.tool.js";
import { GET_DAILY_DEALS, createGetDailyDealsTool } from "./definitions/get-daily-deals.tool.js";
import { GET_FAQ, createGetFaqTool } from "./definitions/get-faq.tool.js";
import { ESCALATE_TO_HUMAN, createEscalateToHumanTool } from "./definitions/escalate-to-human.tool.js";
import { GET_INVOICE, createGetInvoiceTool } from "./definitions/get-invoice.tool.js";
import { CANCEL_ORDER, createCancelOrderTool } from "./definitions/cancel-order.tool.js";

import type { ToolDefinition, ExecutableTool, StoreToolContext } from "./types.js";

export function buildStoreTools(): ToolDefinition[] {
  return [
    SEARCH_PRODUCTS,
    GET_PRODUCT_DETAILS,
    COMPARE_PRODUCTS,
    GET_PRODUCT_AVAILABILITY,
    ADD_ITEM_TO_CART,
    GET_CART,
    REMOVE_CART_ITEM,
    UPDATE_CART_ITEM,
    CLEAR_CART,
    QUOTE_SHIPPING,
    APPLY_COUPON,
    LIST_PROMOTIONS,
    REMOVE_COUPON,
    LIST_CATEGORIES,
    CREATE_CHECKOUT_SESSION,
    GET_REVIEWS,
    CREATE_REVIEW,
    GET_PRODUCT_QUESTIONS,
    CREATE_QUESTION,
    GET_SIMILAR_PRODUCTS,
    ADD_TO_WISHLIST,
    GET_WISHLIST,
    REMOVE_FROM_WISHLIST,
    TRACK_ORDER,
    GET_STORE_POLICIES,
    GET_BUYER_PROFILE,
    GET_DAILY_DEALS,
    GET_FAQ,
    ESCALATE_TO_HUMAN,
    GET_INVOICE,
    CANCEL_ORDER
  ];
}

export function buildExecutableStoreTools(ctx: StoreToolContext): ExecutableTool[] {
  return [
    createSearchProductsTool(ctx),
    createGetProductDetailsTool(ctx),
    createCompareProductsTool(ctx),
    createGetProductAvailabilityTool(ctx),
    createAddItemToCartTool(ctx),
    createGetCartTool(ctx),
    createRemoveCartItemTool(ctx),
    createUpdateCartItemTool(ctx),
    createClearCartTool(ctx),
    createQuoteShippingTool(ctx),
    createApplyCouponTool(ctx),
    createListPromotionsTool(ctx),
    createRemoveCouponTool(ctx),
    createListCategoriesTool(ctx),
    createCreateCheckoutSessionTool(ctx),
    createGetReviewsTool(ctx),
    createCreateReviewTool(ctx),
    createGetProductQuestionsTool(ctx),
    createCreateQuestionTool(ctx),
    createGetSimilarProductsTool(ctx),
    createAddToWishlistTool(ctx),
    createGetWishlistTool(ctx),
    createRemoveFromWishlistTool(ctx),
    createTrackOrderTool(ctx),
    createGetStorePoliciesTool(ctx),
    createGetBuyerProfileTool(ctx),
    createGetDailyDealsTool(ctx),
    createGetFaqTool(ctx),
    createEscalateToHumanTool(ctx),
    createGetInvoiceTool(ctx),
    createCancelOrderTool(ctx)
  ];
}
