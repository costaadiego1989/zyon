/**
 * Store Builder tools — LangChain-style tool definitions for storefront LangGraph agent.
 *
 * 10 deterministic tools for product search, comparison, cart management, shipping quotes,
 * and coupon application. All tools return structured JSON; never free-text.
 *
 * Critical invariant: tools call real repos and never invent data.
 */

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  };
}

export type ToolResult =
  | { ok: true; data: unknown }
  | { ok: false; error: string; code?: string };

export interface ExecutableTool {
  name: string;
  execute: (args: Record<string, unknown>) => Promise<ToolResult>;
}

export interface StoreToolHandlers {
  searchProducts: (args: {
    query: string;
    categoryId?: string;
    maxPrice?: number;
    inStockOnly?: boolean;
    limit?: number;
  }) => Promise<unknown>;
  getProductDetails: (args: { productId: string }) => Promise<unknown>;
  compareProducts: (args: { productIds: string[] }) => Promise<unknown>;
  getProductAvailability: (args: { variantId: string }) => Promise<unknown>;
  addItemToCart: (args: {
    cartId?: string;
    variantId: string;
    quantity: number;
  }) => Promise<unknown>;
  getCart: (args: { cartId: string }) => Promise<unknown>;
  removeCartItem: (args: { cartId: string; variantId: string }) => Promise<unknown>;
  updateCartItem: (args: { cartId: string; variantId: string; quantity: number }) => Promise<unknown>;
  clearCart: (args: { cartId: string }) => Promise<unknown>;
  quoteShipping: (args: { cartId?: string; productId?: string; zipCode: string }) => Promise<unknown>;
  applyCoupon: (args: { cartId: string; couponCode: string }) => Promise<unknown>;
  listPromotions: (args: { cartId: string }) => Promise<unknown>;
  listCategories: () => Promise<unknown>;
  removeCoupon: (args: { cartId: string }) => Promise<unknown>;
  createCheckoutSession: (args: { cartId: string }) => Promise<unknown>;
  getReviews: (args: {
    productId: string;
    filter?: "positive" | "negative" | "recent";
    limit?: number;
  }) => Promise<unknown>;
  createReview: (args: {
    productId: string;
    rating: number;
    text: string;
    authorName: string;
    authorPhone: string;
  }) => Promise<unknown>;
  getProductQuestions: (args: {
    productId: string;
    filter?: "answered" | "unanswered" | "mine";
  }) => Promise<unknown>;
  createQuestion: (args: {
    productId: string;
    question: string;
    authorName: string;
  }) => Promise<unknown>;
  getSimilarProducts: (args: { productId: string; limit?: number }) => Promise<unknown>;
  addToWishlist: (args: { productId: string }) => Promise<unknown>;
  getWishlist: () => Promise<unknown>;
  removeFromWishlist: (args: { productId: string }) => Promise<unknown>;
  trackOrder: (args: { orderId: string }) => Promise<unknown>;
  getStorePolicies: (args: {
    policyType?: "returns" | "exchanges" | "shipping" | "warranty" | "all";
  }) => Promise<unknown>;
  getBuyerProfile: () => Promise<unknown>;
  getDailyDeals: (args: { limit?: number }) => Promise<unknown>;
  getFaq: (args: { category?: string }) => Promise<unknown>;
  escalateToHuman: (args: { reason: string }) => Promise<unknown>;
  getInvoice: (args: { orderId: string }) => Promise<unknown>;
  cancelOrder: (args: { orderId: string; reason?: string }) => Promise<unknown>;
}

export interface StoreToolContext {
  merchantId: string;
  sessionId: string;
  handlers: StoreToolHandlers;
}

// ─── Tool definitions ─────────────────────────────────────────────────────

const SEARCH_PRODUCTS: ToolDefinition = {
  name: "search_products",
  description:
    "Search the merchant's product catalog. Use empty query or '*' to list all/featured products. Use categoryId to filter by category. Returns matching products with id, name, price, image, and stock status.",
  parameters: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description: "Product search query (brand, category, product name, or '*' for all products)"
      },
      categoryId: {
        type: "string",
        description: "Filter by category ID (use this when user wants products from a specific category)"
      },
      maxPrice: {
        type: "number",
        description: "Maximum price in cents (optional)"
      },
      inStockOnly: {
        type: "boolean",
        description: "Return only in-stock products (default: false)"
      },
      limit: {
        type: "number",
        description: "Max results (default: 10, max: 20)"
      },
      sortBy: {
        type: "string",
        enum: ["price_asc", "price_desc", "rating", "best_sellers", "newest", "discount"],
        description:
          "Sort order: price_asc (cheapest first), price_desc (most expensive first), rating (highest rated), best_sellers (most sold), newest (latest added), discount (biggest discount first)"
      }
    },
    required: ["query"]
  }
};

const GET_REVIEWS: ToolDefinition = {
  name: "get_reviews",
  description:
    "Get product reviews. Returns array of reviews with id, author, rating (1-5), text, and date. Use when buyer asks about opinions, ratings, or feedback on a product.",
  parameters: {
    type: "object",
    properties: {
      productId: {
        type: "string",
        description: "Product ID to fetch reviews for"
      },
      filter: {
        type: "string",
        enum: ["positive", "negative", "recent"],
        description:
          "Filter reviews: positive (4-5 stars), negative (1-2 stars), recent (latest first). Optional."
      },
      limit: {
        type: "number",
        description: "Max reviews to return (default: 10, max: 50)"
      }
    },
    required: ["productId"]
  }
};

const CREATE_REVIEW: ToolDefinition = {
  name: "create_review",
  description:
    "Submit a product review on behalf of a buyer. Requires rating (1-5), text, authorName, and authorPhone. The buyer must provide their phone for identification. Returns the created review with id and date.",
  parameters: {
    type: "object",
    properties: {
      productId: {
        type: "string",
        description: "Product ID being reviewed"
      },
      rating: {
        type: "number",
        description: "Rating from 1 (worst) to 5 (best)"
      },
      text: {
        type: "string",
        description: "Review text content"
      },
      authorName: {
        type: "string",
        description: "Display name of the reviewer"
      },
      authorPhone: {
        type: "string",
        description: "Phone number of the reviewer (Brazilian format with DDD, e.g. 11999999999). Required for buyer identification."
      }
    },
    required: ["productId", "rating", "text", "authorName", "authorPhone"]
  }
};

const GET_PRODUCT_QUESTIONS: ToolDefinition = {
  name: "get_product_questions",
  description:
    "Get Q&A for a product. Returns questions with id, question text, answer (if any), author, and date. Use when buyer asks about product details not in the description.",
  parameters: {
    type: "object",
    properties: {
      productId: {
        type: "string",
        description: "Product ID to fetch questions for"
      },
      filter: {
        type: "string",
        enum: ["answered", "unanswered", "mine"],
        description:
          "Filter questions: answered (has reply), unanswered (no reply yet), mine (asked by current buyer). Optional."
      }
    },
    required: ["productId"]
  }
};

const CREATE_QUESTION: ToolDefinition = {
  name: "create_question",
  description:
    "Ask a question about a product on behalf of a buyer. Requires question text and authorName. Returns the created question awaiting an answer.",
  parameters: {
    type: "object",
    properties: {
      productId: {
        type: "string",
        description: "Product ID being asked about"
      },
      question: {
        type: "string",
        description: "Question text"
      },
      authorName: {
        type: "string",
        description: "Display name of the asker"
      }
    },
    required: ["productId", "question", "authorName"]
  }
};

const GET_SIMILAR_PRODUCTS: ToolDefinition = {
  name: "get_similar_products",
  description:
    "Get similar or related products for a given product. Returns products in the same shape as search_products (id, name, price, image, stock). Use when buyer wants alternatives or comparisons.",
  parameters: {
    type: "object",
    properties: {
      productId: {
        type: "string",
        description: "Product ID to find similar items for"
      },
      limit: {
        type: "number",
        description: "Max results (default: 5, max: 20)"
      }
    },
    required: ["productId"]
  }
};

const ADD_TO_WISHLIST: ToolDefinition = {
  name: "add_to_wishlist",
  description:
    "Add a product to the buyer's wishlist. Returns updated wishlist with items.",
  parameters: {
    type: "object",
    properties: {
      productId: {
        type: "string",
        description: "Product ID to add to wishlist"
      }
    },
    required: ["productId"]
  }
};

const GET_WISHLIST: ToolDefinition = {
  name: "get_wishlist",
  description:
    "Get the current buyer's wishlist. Returns array of saved products.",
  parameters: {
    type: "object",
    properties: {},
    required: []
  }
};

const REMOVE_FROM_WISHLIST: ToolDefinition = {
  name: "remove_from_wishlist",
  description:
    "Remove a product from the buyer's wishlist. Returns updated wishlist.",
  parameters: {
    type: "object",
    properties: {
      productId: {
        type: "string",
        description: "Product ID to remove from wishlist"
      }
    },
    required: ["productId"]
  }
};

const TRACK_ORDER: ToolDefinition = {
  name: "track_order",
  description:
    "Track order status and shipping. Returns order status, tracking code, carrier, and estimated delivery date. Use when buyer asks about delivery progress.",
  parameters: {
    type: "object",
    properties: {
      orderId: {
        type: "string",
        description: "Order ID to track"
      }
    },
    required: ["orderId"]
  }
};

const GET_STORE_POLICIES: ToolDefinition = {
  name: "get_store_policies",
  description:
    "Get store policies: returns, exchanges, shipping, or warranty. Returns policy text. Use when buyer asks about return windows, exchange rules, shipping terms, or warranty coverage.",
  parameters: {
    type: "object",
    properties: {
      policyType: {
        type: "string",
        enum: ["returns", "exchanges", "shipping", "warranty", "all"],
        description:
          "Type of policy to retrieve. Use 'all' to get every policy in one call. Default: 'all'."
      }
    },
    required: []
  }
};

const GET_BUYER_PROFILE: ToolDefinition = {
  name: "get_buyer_profile",
  description:
    "Get the logged-in buyer's profile: name, email, saved addresses, and order count. Use to personalize responses or pre-fill checkout.",
  parameters: {
    type: "object",
    properties: {},
    required: []
  }
};

const GET_DAILY_DEALS: ToolDefinition = {
  name: "get_daily_deals",
  description:
    "Get current daily or flash deals. Returns products with deal info including discount percent and expiration time. Use when buyer asks about promotions, deals, or limited-time offers.",
  parameters: {
    type: "object",
    properties: {
      limit: {
        type: "number",
        description: "Max deals to return (default: 10, max: 30)"
      }
    },
    required: []
  }
};

const GET_FAQ: ToolDefinition = {
  name: "get_faq",
  description:
    "Get frequently asked questions for the store. Optionally filter by category (e.g. 'payment', 'shipping', 'account'). Returns FAQ items with question and answer.",
  parameters: {
    type: "object",
    properties: {
      category: {
        type: "string",
        description: "Filter by FAQ category (optional)"
      }
    },
    required: []
  }
};

const ESCALATE_TO_HUMAN: ToolDefinition = {
  name: "escalate_to_human",
  description:
    "Request escalation to a human support agent. Use when the buyer explicitly asks for human help, the issue is too complex, or the buyer is frustrated. Returns ticket/escalation confirmation.",
  parameters: {
    type: "object",
    properties: {
      reason: {
        type: "string",
        description: "Reason for escalation (what the buyer needs help with)"
      }
    },
    required: ["reason"]
  }
};

const GET_INVOICE: ToolDefinition = {
  name: "get_invoice",
  description:
    "Get invoice/nota fiscal for an order. Returns invoice URL and details (number, issue date, total, tax info).",
  parameters: {
    type: "object",
    properties: {
      orderId: {
        type: "string",
        description: "Order ID to fetch invoice for"
      }
    },
    required: ["orderId"]
  }
};

const CANCEL_ORDER: ToolDefinition = {
  name: "cancel_order",
  description:
    "Request cancellation of an order. Optional reason. Returns cancellation status (approved/rejected) and any refund info.",
  parameters: {
    type: "object",
    properties: {
      orderId: {
        type: "string",
        description: "Order ID to cancel"
      },
      reason: {
        type: "string",
        description: "Optional reason for cancellation"
      }
    },
    required: ["orderId"]
  }
};

const GET_PRODUCT_DETAILS: ToolDefinition = {
  name: "get_product_details",
  description:
    "Get complete product details: description, variants, media, reviews, rating, and stock for each variant.",
  parameters: {
    type: "object",
    properties: {
      productId: {
        type: "string",
        description: "Product ID"
      }
    },
    required: ["productId"]
  }
};

const COMPARE_PRODUCTS: ToolDefinition = {
  name: "compare_products",
  description:
    "Compare multiple products side-by-side. Returns table with id, name, attributes, price, stock, and rating.",
  parameters: {
    type: "object",
    properties: {
      productIds: {
        type: "array",
        items: { type: "string" },
        description: "Array of product IDs (max 5)"
      }
    },
    required: ["productIds"]
  }
};

const GET_PRODUCT_AVAILABILITY: ToolDefinition = {
  name: "get_product_availability",
  description:
    "Check real-time stock for a specific variant. Returns inStock flag, quantity, and estimated shipping days.",
  parameters: {
    type: "object",
    properties: {
      variantId: {
        type: "string",
        description: "Product variant ID"
      }
    },
    required: ["variantId"]
  }
};

const ADD_ITEM_TO_CART: ToolDefinition = {
  name: "add_item_to_cart",
  description:
    "Add product variant to cart. Creates new cart if cartId omitted. Returns updated cart with items, total, and cartId.",
  parameters: {
    type: "object",
    properties: {
      cartId: {
        type: "string",
        description: "Existing cart ID (optional; creates new if omitted)"
      },
      variantId: {
        type: "string",
        description: "Product variant ID"
      },
      quantity: {
        type: "number",
        description: "Quantity to add (min: 1)"
      }
    },
    required: ["variantId", "quantity"]
  }
};

const GET_CART: ToolDefinition = {
  name: "get_cart",
  description: "Retrieve current cart state: items, total price, item count, and applied discounts.",
  parameters: {
    type: "object",
    properties: {
      cartId: {
        type: "string",
        description: "Cart ID"
      }
    },
    required: ["cartId"]
  }
};

const REMOVE_CART_ITEM: ToolDefinition = {
  name: "remove_cart_item",
  description: "Remove product variant from cart. Returns updated cart.",
  parameters: {
    type: "object",
    properties: {
      cartId: {
        type: "string",
        description: "Cart ID"
      },
      variantId: {
        type: "string",
        description: "Product variant ID to remove"
      }
    },
    required: ["cartId", "variantId"]
  }
};

const QUOTE_SHIPPING: ToolDefinition = {
  name: "quote_shipping",
  description:
    "Get shipping quote. Can quote for a cart OR for a single product (by productId). Returns carriers (Sedex, PAC), price in cents, and delivery days. Does NOT require product to be in cart.",
  parameters: {
    type: "object",
    properties: {
      cartId: {
        type: "string",
        description: "Cart ID (optional — use when quoting for whole cart)"
      },
      productId: {
        type: "string",
        description: "Product ID (optional — use when quoting shipping for a specific product without cart)"
      },
      zipCode: {
        type: "string",
        description: "8-digit Brazilian CEP or ZIP code"
      }
    },
    required: ["zipCode"]
  }
};

const APPLY_COUPON: ToolDefinition = {
  name: "apply_coupon",
  description:
    "Apply coupon code to cart. Returns whether applied, discount amount, new total, and reason if failed.",
  parameters: {
    type: "object",
    properties: {
      cartId: {
        type: "string",
        description: "Cart ID"
      },
      couponCode: {
        type: "string",
        description: "Coupon code (uppercase)"
      }
    },
    required: ["cartId", "couponCode"]
  }
};

const CREATE_CHECKOUT_SESSION: ToolDefinition = {
  name: "create_checkout_session",
  description: "Hand off cart to checkout widget. Returns checkout URL and session ID for payment flow.",
  parameters: {
    type: "object",
    properties: {
      cartId: {
        type: "string",
        description: "Cart ID to checkout"
      }
    },
    required: ["cartId"]
  }
};

const UPDATE_CART_ITEM: ToolDefinition = {
  name: "update_cart_item",
  description: "Update quantity of an item already in the cart. Returns updated cart.",
  parameters: {
    type: "object",
    properties: {
      cartId: {
        type: "string",
        description: "Cart ID"
      },
      variantId: {
        type: "string",
        description: "Product variant ID to update"
      },
      quantity: {
        type: "number",
        description: "New quantity (min: 1, max: 99)"
      }
    },
    required: ["cartId", "variantId", "quantity"]
  }
};

const CLEAR_CART: ToolDefinition = {
  name: "clear_cart",
  description: "Remove all items from the cart. Returns empty cart.",
  parameters: {
    type: "object",
    properties: {
      cartId: {
        type: "string",
        description: "Cart ID"
      }
    },
    required: ["cartId"]
  }
};

const LIST_PROMOTIONS: ToolDefinition = {
  name: "list_promotions",
  description:
    "List active promotions and coupons available for this merchant. Returns available discount codes, minimum cart value requirements, and expiration.",
  parameters: {
    type: "object",
    properties: {
      cartId: {
        type: "string",
        description: "Cart ID (to check eligibility)"
      }
    },
    required: ["cartId"]
  }
};

const REMOVE_COUPON: ToolDefinition = {
  name: "remove_coupon",
  description: "Remove an applied coupon from the cart. Returns updated cart without discount.",
  parameters: {
    type: "object",
    properties: {
      cartId: {
        type: "string",
        description: "Cart ID"
      }
    },
    required: ["cartId"]
  }
};

const LIST_CATEGORIES: ToolDefinition = {
  name: "list_categories",
  description:
    "List all product categories for this store. Returns category names and IDs for browsing by section.",
  parameters: {
    type: "object",
    properties: {},
    required: []
  }
};

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

// ─── Executable tools ─────────────────────────────────────────────────────

function wrapHandler(
  name: string,
  fn: (args: any) => Promise<unknown>
): ExecutableTool {
  return {
    name,
    execute: async (args: Record<string, unknown>): Promise<ToolResult> => {
      try {
        const data = await fn(args as any);
        return { ok: true, data };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        const code = err instanceof Error && (err as any).code ? (err as any).code : undefined;
        return { ok: false, error: message, code };
      }
    }
  };
}

export function createSearchProductsTool(ctx: StoreToolContext): ExecutableTool {
  return wrapHandler("search_products", (args) => ctx.handlers.searchProducts(args));
}

export function createGetProductDetailsTool(ctx: StoreToolContext): ExecutableTool {
  return wrapHandler("get_product_details", (args) => ctx.handlers.getProductDetails(args));
}

export function createCompareProductsTool(ctx: StoreToolContext): ExecutableTool {
  return wrapHandler("compare_products", (args) => ctx.handlers.compareProducts(args));
}

export function createGetProductAvailabilityTool(ctx: StoreToolContext): ExecutableTool {
  return wrapHandler("get_product_availability", (args) =>
    ctx.handlers.getProductAvailability(args)
  );
}

export function createAddItemToCartTool(ctx: StoreToolContext): ExecutableTool {
  return wrapHandler("add_item_to_cart", (args) => ctx.handlers.addItemToCart(args));
}

export function createGetCartTool(ctx: StoreToolContext): ExecutableTool {
  return wrapHandler("get_cart", (args) => ctx.handlers.getCart(args));
}

export function createRemoveCartItemTool(ctx: StoreToolContext): ExecutableTool {
  return wrapHandler("remove_cart_item", (args) => ctx.handlers.removeCartItem(args));
}

export function createUpdateCartItemTool(ctx: StoreToolContext): ExecutableTool {
  return wrapHandler("update_cart_item", (args) => ctx.handlers.updateCartItem(args));
}

export function createClearCartTool(ctx: StoreToolContext): ExecutableTool {
  return wrapHandler("clear_cart", (args) => ctx.handlers.clearCart(args));
}

export function createQuoteShippingTool(ctx: StoreToolContext): ExecutableTool {
  return wrapHandler("quote_shipping", (args) => ctx.handlers.quoteShipping(args));
}

export function createApplyCouponTool(ctx: StoreToolContext): ExecutableTool {
  return wrapHandler("apply_coupon", (args) => ctx.handlers.applyCoupon(args));
}

export function createListPromotionsTool(ctx: StoreToolContext): ExecutableTool {
  return wrapHandler("list_promotions", (args) => ctx.handlers.listPromotions(args));
}

export function createRemoveCouponTool(ctx: StoreToolContext): ExecutableTool {
  return wrapHandler("remove_coupon", (args) => ctx.handlers.removeCoupon(args));
}

export function createListCategoriesTool(ctx: StoreToolContext): ExecutableTool {
  return wrapHandler("list_categories", () => ctx.handlers.listCategories());
}

export function createCreateCheckoutSessionTool(ctx: StoreToolContext): ExecutableTool {
  return wrapHandler("create_checkout_session", (args) =>
    ctx.handlers.createCheckoutSession(args)
  );
}

export function createGetReviewsTool(ctx: StoreToolContext): ExecutableTool {
  return wrapHandler("get_reviews", (args) => ctx.handlers.getReviews(args));
}

export function createCreateReviewTool(ctx: StoreToolContext): ExecutableTool {
  return wrapHandler("create_review", (args) => ctx.handlers.createReview(args));
}

export function createGetProductQuestionsTool(ctx: StoreToolContext): ExecutableTool {
  return wrapHandler("get_product_questions", (args) =>
    ctx.handlers.getProductQuestions(args)
  );
}

export function createCreateQuestionTool(ctx: StoreToolContext): ExecutableTool {
  return wrapHandler("create_question", (args) => ctx.handlers.createQuestion(args));
}

export function createGetSimilarProductsTool(ctx: StoreToolContext): ExecutableTool {
  return wrapHandler("get_similar_products", (args) => ctx.handlers.getSimilarProducts(args));
}

export function createAddToWishlistTool(ctx: StoreToolContext): ExecutableTool {
  return wrapHandler("add_to_wishlist", (args) => ctx.handlers.addToWishlist(args));
}

export function createGetWishlistTool(ctx: StoreToolContext): ExecutableTool {
  return wrapHandler("get_wishlist", () => ctx.handlers.getWishlist());
}

export function createRemoveFromWishlistTool(ctx: StoreToolContext): ExecutableTool {
  return wrapHandler("remove_from_wishlist", (args) =>
    ctx.handlers.removeFromWishlist(args)
  );
}

export function createTrackOrderTool(ctx: StoreToolContext): ExecutableTool {
  return wrapHandler("track_order", (args) => ctx.handlers.trackOrder(args));
}

export function createGetStorePoliciesTool(ctx: StoreToolContext): ExecutableTool {
  return wrapHandler("get_store_policies", (args) => ctx.handlers.getStorePolicies(args));
}

export function createGetBuyerProfileTool(ctx: StoreToolContext): ExecutableTool {
  return wrapHandler("get_buyer_profile", () => ctx.handlers.getBuyerProfile());
}

export function createGetDailyDealsTool(ctx: StoreToolContext): ExecutableTool {
  return wrapHandler("get_daily_deals", (args) => ctx.handlers.getDailyDeals(args));
}

export function createGetFaqTool(ctx: StoreToolContext): ExecutableTool {
  return wrapHandler("get_faq", (args) => ctx.handlers.getFaq(args));
}

export function createEscalateToHumanTool(ctx: StoreToolContext): ExecutableTool {
  return wrapHandler("escalate_to_human", (args) => ctx.handlers.escalateToHuman(args));
}

export function createGetInvoiceTool(ctx: StoreToolContext): ExecutableTool {
  return wrapHandler("get_invoice", (args) => ctx.handlers.getInvoice(args));
}

export function createCancelOrderTool(ctx: StoreToolContext): ExecutableTool {
  return wrapHandler("cancel_order", (args) => ctx.handlers.cancelOrder(args));
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
