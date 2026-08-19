/**
 * V2 DATA SOURCE — backward compatible with V1 internal API
 *
 * This is the bridge between V1 (internal routes) and V2 (v1 public API).
 * Uses feature flag to choose source. Zero behavioral change when flag is off.
 *
 * Usage:
 *   import { productsApi } from "@/lib/api/api-client";
 *   const products = await productsApi.list(merchantId, { limit: 10 });
 */

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:3009";
const API_V1_PROXY = "/api/v1";

const FEATURE_FLAGS = {
  products: process.env.NEXT_PUBLIC_USE_V1_PRODUCTS === "true",
  settings: process.env.NEXT_PUBLIC_USE_V1_SETTINGS === "true",
  checkouts: process.env.NEXT_PUBLIC_USE_V1_CHECKOUTS === "true",
};

/** Common JSON envelope from v1 API */
export interface ApiEnvelope<T> {
  data: T;
  meta: {
    request_id: string;
    timestamp: string;
    version: string;
  };
  pagination?: {
    next_cursor: string | null;
    has_more: boolean;
  };
}

/** Product domain model (v1 format) */
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

/** Paginated product list */
export interface ProductListResponse {
  products: Product[];
  nextCursor?: string;
}

/** Fetch with error handling */
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
    try {
      error.body = await res.json();
    } catch {
      // ignore
    }
    throw error;
  }

  return res.json();
}

/** Map v1 API product → V1 internal product format */
function mapV1Product(p: any): Product {
  return {
    id: p.id,
    name: p.name,
    description: p.description,
    price: p.price ?? 0,
    image: p.image ?? p.images?.[0],
    images: p.images ?? [],
    inStock: p.in_stock ?? p.inStock ?? true,
    rating: p.rating,
    reviewCount: p.review_count ?? p.reviewCount,
    variants: p.variants,
    discountPercent: p.discount_percent,
    originalPrice: p.original_price,
  };
}

/** PRODUCTS API */
export const productsApi = {
  /** List products with pagination */
  async list(
    merchantId: string,
    options?: {
      query?: string;
      categoryId?: string;
      limit?: number;
      cursor?: string;
    },
  ): Promise<ProductListResponse> {
    if (FEATURE_FLAGS.products) {
      // ─── V2 path: /v1/products ───
      const params = new URLSearchParams();
      if (options?.query) params.set("search", options.query);
      if (options?.limit) params.set("limit", String(options.limit));
      if (options?.cursor) params.set("cursor", options.cursor);

      const qs = params.toString();
      const envelope: ApiEnvelope<any[]> = await safeFetch(
        `${API_V1_PROXY}/products${qs ? `?${qs}` : ""}`,
      );

      return {
        products: envelope.data.map(mapV1Product),
        nextCursor: envelope.pagination?.next_cursor ?? undefined,
      };
    } else {
      // ─── V1 path: /merchants/{id}/products (current behavior) ───
      const params = new URLSearchParams();
      if (options?.query) params.set("query", options.query);
      if (options?.categoryId) params.set("categoryId", options.categoryId);
      if (options?.limit) params.set("limit", String(options.limit));
      if (options?.cursor) params.set("cursor", options.cursor);

      const qs = params.toString();
      const result = await safeFetch(
        `${API_BASE}/merchants/${merchantId}/products?${qs}`,
        { credentials: "include" },
      );

      return {
        products: result.products ?? [],
        nextCursor: result.nextCursor,
      };
    }
  },

  /** Get single product */
  async get(merchantId: string, productId: string): Promise<Product | null> {
    if (FEATURE_FLAGS.products) {
      const envelope: ApiEnvelope<any> = await safeFetch(
        `${API_V1_PROXY}/products/${productId}`,
      );
      return mapV1Product(envelope.data);
    } else {
      const result = await safeFetch(
        `${API_BASE}/merchants/${merchantId}/products/${productId}`,
        { credentials: "include" },
      );
      return result ?? null;
    }
  },
};

/** SETTINGS API */
export const settingsApi = {
  async getCheckoutSettings(merchantId: string): Promise<any> {
    if (FEATURE_FLAGS.settings) {
      const envelope: ApiEnvelope<any> = await safeFetch(
        `${API_V1_PROXY}/settings/checkout`,
      );
      return envelope.data;
    } else {
      return safeFetch(
        `${API_BASE}/checkout-settings/widget-config?merchantId=${encodeURIComponent(merchantId)}`,
      );
    }
  },

  async getStoreSettings(slug: string): Promise<any> {
    if (FEATURE_FLAGS.settings) {
      const envelope: ApiEnvelope<any> = await safeFetch(
        `${API_V1_PROXY}/settings/store`,
      );
      return envelope.data;
    } else {
      return safeFetch(`${API_BASE}/storefront/${slug}/config`);
    }
  },
};

/** MARKETPLACE API (search) */
export const marketplaceApi = {
  async search(query: string, options?: { limit?: number }): Promise<any[]> {
    if (FEATURE_FLAGS.products) {
      const params = new URLSearchParams();
      params.set("search", query);
      if (options?.limit) params.set("limit", String(options.limit));

      const envelope: ApiEnvelope<any[]> = await safeFetch(
        `${API_V1_PROXY}/products?${params.toString()}`,
      );
      return envelope.data.map(mapV1Product);
    } else {
      const params = new URLSearchParams();
      params.set("q", query);
      if (options?.limit) params.set("limit", String(options.limit));

      const result = await safeFetch(
        `${API_BASE}/storefront/marketplace/search?${params.toString()}`,
      );
      return result.items ?? [];
    }
  },

  async list(options?: { limit?: number; cursor?: string }): Promise<any[]> {
    if (FEATURE_FLAGS.products) {
      const params = new URLSearchParams();
      if (options?.limit) params.set("limit", String(options.limit));
      if (options?.cursor) params.set("cursor", options.cursor);

      const envelope: ApiEnvelope<any[]> = await safeFetch(
        `${API_V1_PROXY}/products?${params.toString()}`,
      );
      return envelope.data.map(mapV1Product);
    } else {
      const params = new URLSearchParams();
      if (options?.limit) params.set("limit", String(options.limit));

      const result = await safeFetch(
        `${API_BASE}/storefront/marketplace/items?${params.toString()}`,
      );
      return result.items ?? [];
    }
  },
};

/** CHECKOUT / CONVERSATION API */
export const checkoutApi = {
  async create(data: {
    merchantId: string;
    customerId?: string;
    items?: any[];
  }): Promise<any> {
    if (FEATURE_FLAGS.checkouts) {
      const envelope: ApiEnvelope<any> = await safeFetch(
        `${API_V1_PROXY}/checkouts`,
        {
          method: "POST",
          body: JSON.stringify({
            merchant_id: data.merchantId,
            customer_id: data.customerId,
            items: data.items,
          }),
        },
      );
      return envelope.data;
    } else {
      return safeFetch(`${API_BASE}/storefront/conversations`, {
        method: "POST",
        body: JSON.stringify({
          merchant_id: data.merchantId,
          customer_id: data.customerId,
          items: data.items,
        }),
      });
    }
  },

  async sendMessage(checkoutId: string, text: string, token?: string): Promise<any> {
    if (FEATURE_FLAGS.checkouts) {
      const envelope: ApiEnvelope<any> = await safeFetch(
        `${API_V1_PROXY}/checkouts/${checkoutId}/messages`,
        {
          method: "POST",
          body: JSON.stringify({ text }),
        },
      );
      return envelope.data;
    } else {
      return safeFetch(`${API_BASE}/storefront/conversations/${checkoutId}/messages`, {
        method: "POST",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: JSON.stringify({ text }),
      });
    }
  },
};

/** CART API */
export const cartApi = {
  async get(cartId: string, merchantId: string): Promise<any> {
    if (FEATURE_FLAGS.checkouts) {
      const envelope: ApiEnvelope<any> = await safeFetch(
        `${API_V1_PROXY}/checkouts/${cartId}`,
      );
      return envelope.data;
    } else {
      return safeFetch(
        `${API_BASE}/storefront/cart/${encodeURIComponent(cartId)}?merchantId=${encodeURIComponent(merchantId)}`,
      );
    }
  },

  async updateItem(
    cartId: string,
    variantId: string,
    quantity: number,
    merchantId: string,
  ): Promise<any> {
    if (FEATURE_FLAGS.checkouts) {
      const envelope: ApiEnvelope<any> = await safeFetch(
        `${API_V1_PROXY}/checkouts/${cartId}/cart`,
        {
          method: "PATCH",
          body: JSON.stringify({
            items: [{ variant_id: variantId, quantity }],
          }),
        },
      );
      return envelope.data;
    } else {
      return safeFetch(
        `${API_BASE}/storefront/cart/${encodeURIComponent(cartId)}/items/${encodeURIComponent(variantId)}`,
        {
          method: quantity === 0 ? "DELETE" : "PATCH",
          body: JSON.stringify({ quantity }),
        },
      );
    }
  },
};

/** Export feature flags for runtime introspection */
export const isUsingV1Api = {
  products: () => FEATURE_FLAGS.products,
  settings: () => FEATURE_FLAGS.settings,
  checkouts: () => FEATURE_FLAGS.checkouts,
};
