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
  quoteShipping: (args: { cartId: string; zipCode: string }) => Promise<unknown>;
  applyCoupon: (args: { cartId: string; couponCode: string }) => Promise<unknown>;
  listPromotions: (args: { cartId: string }) => Promise<unknown>;
  listCategories: () => Promise<unknown>;
  removeCoupon: (args: { cartId: string }) => Promise<unknown>;
  createCheckoutSession: (args: { cartId: string }) => Promise<unknown>;
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
    "Search the merchant's product catalog. Returns matching products with id, name, price, image, and stock status.",
  parameters: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description: "Product search query (brand, category, or product name)"
      },
      categoryId: {
        type: "string",
        description: "Filter by category ID (optional)"
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
      }
    },
    required: ["query"]
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
    "Get shipping quote for cart. Returns carriers (Sedex, PAC), price in cents, and delivery days.",
  parameters: {
    type: "object",
    properties: {
      cartId: {
        type: "string",
        description: "Cart ID"
      },
      zipCode: {
        type: "string",
        description: "8-digit Brazilian CEP or ZIP code"
      }
    },
    required: ["cartId", "zipCode"]
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
    CREATE_CHECKOUT_SESSION
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
    createCreateCheckoutSessionTool(ctx)
  ];
}
