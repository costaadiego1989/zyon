const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:3009";
export interface Product {
  id: string;
  name: string;
  description?: string;
  price: number;
  image?: string;
  images?: string[];
  inStock: boolean;
  rating?: number;
  reviewCount?: number;
  variants?: Array<{ id: string; value: string }>;
  discountPercent?: number;
  originalPrice?: number;
}
export interface ProductListResponse {
  products: Product[];
  nextCursor?: string;
}
async function safeFetch(url: string, options?: RequestInit) {
  const res = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...options?.headers,
    },
  });
  if (!res.ok) {
    const error: any = new Error(`HTTP ${res.status}`);
    error.status = res.status;
    try { error.body = await res.json(); } catch { /* */ }
    throw error;
  }

  return res.json();
}
export const productsApi = {
  async list(
    merchantId: string,
    options?: {
      query?: string;
      categoryId?: string;
      limit?: number;
      cursor?: string;
    },
  ): Promise<ProductListResponse> {
    const params = new URLSearchParams();
    if (options?.query) params.set("query", options.query);
    if (options?.categoryId) params.set("categoryId", options.categoryId);
    if (options?.limit) params.set("limit", String(options.limit));
    if (options?.cursor) params.set("cursor", options.cursor);

    const qs = params.toString();
    const result = await safeFetch(
      `${API_BASE}/merchants/${merchantId}/products${qs ? `?${qs}` : ""}`,
      { credentials: "include" },
    );
    return {
      products: result.products ?? [],
      nextCursor: result.nextCursor,
    };
  },
  async get(merchantId: string, productId: string): Promise<Product | null> {
    const result = await safeFetch(
      `${API_BASE}/merchants/${merchantId}/products/${productId}`,
      { credentials: "include" },
    );
    return result ?? null;
  },
};
export const settingsApi = {
  async getCheckoutSettings(merchantId: string): Promise<any> {
    return safeFetch(
      `${API_BASE}/checkout-settings/widget-config?merchantId=${encodeURIComponent(merchantId)}`,
    );
  },

  async getStoreSettings(slug: string): Promise<any> {
    return safeFetch(`${API_BASE}/storefront/${slug}/config`);
  },
};
export const marketplaceApi = {
  async search(query: string, options?: { limit?: number }): Promise<any[]> {
    const params = new URLSearchParams();
    params.set("q", query);
    if (options?.limit) params.set("limit", String(options.limit));
    const result = await safeFetch(
      `${API_BASE}/storefront/marketplace/search?${params.toString()}`,
    );
    return result.items ?? [];
  },
  async list(options?: { limit?: number; cursor?: string }): Promise<any[]> {
    const params = new URLSearchParams();
    if (options?.limit) params.set("limit", String(options.limit));

    const result = await safeFetch(
      `${API_BASE}/storefront/marketplace/items?${params.toString()}`,
    );
    return result.items ?? [];
  },
};
export const checkoutApi = {
  async create(data: {
    merchantId: string;
    customerId?: string;
    items?: any[];
  }): Promise<any> {
    return safeFetch(`${API_BASE}/storefront/conversations`, {
      method: "POST",
      body: JSON.stringify({
        merchant_id: data.merchantId,
        customer_id: data.customerId,
        items: data.items,
      }),
    });
  },

  async generateNudge(merchantId: string, trigger: "idle_30_seconds" | "exit_intent_detected", stage: "cart" | "browsing", fallback: string): Promise<{ message: string }> {
    return safeFetch(`${API_BASE}/storefront/nudge`, {
      method: "POST",
      body: JSON.stringify({ merchant_id: merchantId, trigger, stage, fallback }),
    });
  },

  async sendMessage(checkoutId: string, text: string, options?: {
    token?: string;
    merchantId?: string;
    cartId?: string;
    history?: any[];
    variantId?: string;
  }): Promise<any> {
    return safeFetch(`${API_BASE}/storefront/conversations/${checkoutId}/messages`, {
      method: "POST",
      headers: options?.token ? { Authorization: `Bearer ${options.token}` } : {},
      body: JSON.stringify({
        merchant_id: options?.merchantId,
        user_message: text,
        cart_id: options?.cartId || undefined,
        history: options?.history,
        variant_id: options?.variantId || undefined,
      }),
    });
  },
};
export const cartApi = {
  async get(cartId: string, merchantId: string): Promise<any> {
    return safeFetch(
      `${API_BASE}/storefront/cart/${encodeURIComponent(cartId)}?merchantId=${encodeURIComponent(merchantId)}`,
    );
  },
  async updateItem(
    cartId: string,
    variantId: string,
    quantity: number,
    merchantId: string,
  ): Promise<any> {
    return safeFetch(
      `${API_BASE}/storefront/cart/${encodeURIComponent(cartId)}/items/${encodeURIComponent(variantId)}?merchantId=${encodeURIComponent(merchantId)}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ quantity }),
      },
    );
  },
};
export const intentMemoryApi = {
  async getConsent(buyerToken: string): Promise<any> {
    return safeFetch(`${API_BASE}/buyer/consent/intent-memory`, {
      headers: { Authorization: `Bearer ${buyerToken}` },
    }).catch(() => null);
  },
  async deleteConsent(buyerToken: string): Promise<boolean> {
    try {
      await safeFetch(`${API_BASE}/buyer/consent/intent-memory`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${buyerToken}` },
      });
      return true;
    } catch {
      return false;
    }
  },
};
