/**
 * STOREFRONT API CLIENT — consumes headless API v1 exclusively.
 *
 * All calls go through /api/v1 proxy (Next.js route that injects API key).
 * No internal routes. No feature flags. Pure headless commerce consumer.
 *
 * This is how ANY customer (PHP, React Native, Flutter) would consume the API.
 */

const API_V1 = "/api/v1";

// ─── Types ───────────────────────────────────────────────────

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

// ─── HTTP Client ─────────────────────────────────────────────

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

// ─── Mappers ─────────────────────────────────────────────────

function mapV1Product(p: any): Product {
  const firstVariant = p.variants?.[0];
  const price = firstVariant?.base_price_minor ?? p.price ?? 0;

  return {
    id: p.id,
    name: p.name,
    description: p.description,
    price,
    image: firstVariant?.media?.[0]?.url ?? p.image ?? p.images?.[0],
    images: firstVariant?.media?.map((m: any) => m.url) ?? p.images ?? [],
    inStock: p.in_stock ?? (firstVariant ? (firstVariant.stock_quantity - (firstVariant.stock_reserved ?? 0)) > 0 : true),
    rating: p.rating ?? p.average_rating,
    reviewCount: p.review_count ?? p.reviewCount,
    variants: p.variants?.map((v: any) => ({
      id: v.id,
      value: v.sku ?? v.attributes?.color ?? v.attributes?.size ?? v.id,
    })),
    discountPercent: p.discount_percent ?? p.discountPercent,
    originalPrice: p.original_price ?? p.originalPrice,
  };
}

function mapV1CheckoutSettings(d: any): any {
  const wb = d.widget_behavior ?? {};
  return {
    mode: d.mode ?? "silent_until_trigger",
    position: wb.position ?? "bottom_right",
    fabColor: wb.fab_color,
    inviteText: wb.invite_text,
    presentationMode: wb.presentation_mode ?? "fab",
    cartPresentationMode: wb.cart_presentation_mode ?? "floating",
    budgetModeEnabled: wb.budget_mode_enabled ?? false,
    startMinimized: wb.start_minimized ?? false,
    initialDelaySeconds: wb.initial_delay_seconds ?? 4,
    showCartBadge: wb.show_cart_badge ?? true,
    fabClickAction: wb.fab_click_action,
    fabRedirectUrl: wb.fab_redirect_url,
    openWidgetOnTrigger: wb.open_widget_on_trigger ?? true,
    enabledTriggers: (d.trigger_rules ?? [])
      .filter((r: any) => r.enabled)
      .map((r: any) => r.trigger),
    suppressedSteps: (d.suppression_rules ?? [])
      .filter((r: any) => r.enabled)
      .map((r: any) => r.step),
    blockedRegions: d.blocked_regions ?? [],
    minimumCartValue: d.minimum_cart_value,
    handoffEnabled: d.handoff?.enabled ?? false,
    handoffMessage: d.handoff?.message ?? "",
    handoffChannels: d.handoff?.channels ?? [],
    cooldownSeconds: d.cooldown_seconds,
    maxInterventionsPerSession: d.max_interventions_per_session,
  };
}

function mapV1MessageResponse(d: any): any {
  return {
    message: d.content ?? d.message ?? "",
    blocks: d.experience?.blocks ?? d.blocks ?? [],
    suggested_next: d.experience?.suggested_next ?? d.suggested_next ?? [],
    conversation_id: d.conversation_id,
  };
}

// ─── Products API ────────────────────────────────────────────

export const productsApi = {
  async list(
    _merchantId: string,
    options?: {
      query?: string;
      categoryId?: string;
      limit?: number;
      cursor?: string;
    },
  ): Promise<ProductListResponse> {
    const params = new URLSearchParams();
    if (options?.query) params.set("search", options.query);
    if (options?.limit) params.set("limit", String(options.limit));
    if (options?.cursor) params.set("cursor", options.cursor);

    const qs = params.toString();
    const envelope: ApiEnvelope<any[]> = await safeFetch(
      `${API_V1}/products${qs ? `?${qs}` : ""}`,
    );

    return {
      products: envelope.data.map(mapV1Product),
      nextCursor: envelope.pagination?.next_cursor ?? undefined,
    };
  },

  async get(_merchantId: string, productId: string): Promise<Product | null> {
    const envelope: ApiEnvelope<any> = await safeFetch(
      `${API_V1}/products/${productId}`,
    );
    return mapV1Product(envelope.data);
  },
};

// ─── Settings API ────────────────────────────────────────────

export const settingsApi = {
  async getCheckoutSettings(_merchantId: string): Promise<any> {
    const envelope: ApiEnvelope<any> = await safeFetch(
      `${API_V1}/settings/checkout`,
    );
    return mapV1CheckoutSettings(envelope.data);
  },

  async getStoreSettings(_slug: string): Promise<any> {
    const envelope: ApiEnvelope<any> = await safeFetch(
      `${API_V1}/settings/store`,
    );
    return envelope.data;
  },
};

// ─── Marketplace API ─────────────────────────────────────────

export const marketplaceApi = {
  async search(query: string, options?: { limit?: number }): Promise<any[]> {
    const params = new URLSearchParams();
    params.set("search", query);
    if (options?.limit) params.set("limit", String(options.limit));

    const envelope: ApiEnvelope<any[]> = await safeFetch(
      `${API_V1}/products?${params.toString()}`,
    );
    return envelope.data.map(mapV1Product);
  },

  async list(options?: { limit?: number; cursor?: string }): Promise<any[]> {
    const params = new URLSearchParams();
    if (options?.limit) params.set("limit", String(options.limit));
    if (options?.cursor) params.set("cursor", options.cursor);

    const envelope: ApiEnvelope<any[]> = await safeFetch(
      `${API_V1}/products?${params.toString()}`,
    );
    return envelope.data.map(mapV1Product);
  },
};

// ─── Checkout API ────────────────────────────────────────────

export const checkoutApi = {
  async create(data: {
    merchantId: string;
    customerId?: string;
    items?: any[];
  }): Promise<any> {
    const envelope: ApiEnvelope<any> = await safeFetch(
      `${API_V1}/checkouts`,
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
  },

  async sendMessage(checkoutId: string, text: string, options?: {
    merchantId?: string;
    cartId?: string;
    history?: any[];
    variantId?: string;
  }): Promise<any> {
    const envelope: ApiEnvelope<any> = await safeFetch(
      `${API_V1}/checkouts/${checkoutId}/messages`,
      {
        method: "POST",
        body: JSON.stringify({
          user_message: text,
          conversation_id: checkoutId,
        }),
      },
    );
    return mapV1MessageResponse(envelope.data);
  },
};

// ─── Cart API ────────────────────────────────────────────────

export const cartApi = {
  async get(cartId: string, _merchantId: string): Promise<any> {
    const envelope: ApiEnvelope<any> = await safeFetch(
      `${API_V1}/checkouts/${cartId}`,
    );
    return envelope.data;
  },

  async updateItem(
    cartId: string,
    variantId: string,
    quantity: number,
    _merchantId: string,
  ): Promise<any> {
    const envelope: ApiEnvelope<any> = await safeFetch(
      `${API_V1}/checkouts/${cartId}/cart`,
      {
        method: "PATCH",
        body: JSON.stringify({
          items: [{ variant_id: variantId, quantity }],
        }),
      },
    );
    return envelope.data;
  },
};
