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
    /**
     * Food option item ids the buyer selected (size, add-ons). The server
     * validates them against the product's stored option groups and re-computes
     * the authoritative unit price — the client price is never trusted.
     */
    selectedOptionItemIds?: string[];
    /**
     * Cross-sell promotion id when the buyer accepted a cross-sell suggestion.
     * The server validates the sku is in the promo's recommended_skus and applies
     * the authorized discount server-side (never trust client-sent prices).
     */
    crossSellPromoId?: string;
  }) => Promise<unknown>;
  getCart: (args: { cartId: string }) => Promise<unknown>;
  removeCartItem: (args: { cartId: string; variantId: string }) => Promise<unknown>;
  updateCartItem: (args: { cartId: string; variantId: string; quantity: number }) => Promise<unknown>;
  clearCart: (args: { cartId: string }) => Promise<unknown>;
  quoteShipping: (args: { cartId?: string; productId?: string; zipCode: string }) => Promise<unknown>;
  applyCoupon: (args: { cartId?: string; couponCode: string }) => Promise<unknown>;
  listPromotions: (args: { cartId?: string }) => Promise<unknown>;
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

export function wrapHandler(
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
