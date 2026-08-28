/**
 * STOREFRONT API CLIENT
 *
 * Architecture:
 * - OUR storefront is multi-tenant (serves many merchants by slug)
 * - External customers are single-tenant (have their own API key)
 *
 * For our storefront:
 * - Catalog/products: internal route (scoped by merchantId param)
 * - Checkout/messages: internal route (uses embed token for auth)
 * - Cart: internal route (scoped by merchantId)
 * - Settings: loaded via SSR (server-client.ts)
 *
 * For external customers consuming our headless API:
 * - Everything goes through /v1 with their API key
 * - They DON'T use this file — they use the SDK (zyon-sdk)
 *
 * This file is the STOREFRONT's integration layer. Customers use the SDK.
 */

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:3009";

// ─── Types ───────────────────────────────────────────────────

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

// ─── HTTP ────────────────────────────────────────────────────

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

// ─── Products (internal route — multi-tenant by merchantId) ──

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

// ─── Settings (loaded via SSR — this is for client-side refresh) ──

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

// ─── Marketplace (internal — federated cross-merchant) ───────

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

// ─── Checkout / Conversations (internal — embed token auth) ──

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

// ─── Cart (internal — scoped by merchantId) ──────────────────

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
        // The controller exposes only PATCH; the repo treats quantity <= 0 as
        // removal, so a zero-quantity PATCH deletes the line item.
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ quantity }),
      },
    );
  },
};

// ─── Intent Memory / LGPD Consent (internal — buyer auth required) ──

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
