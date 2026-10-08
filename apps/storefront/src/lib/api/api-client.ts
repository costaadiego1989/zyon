/**
 * STOREFRONT API CLIENT
 *
 * Architecture:
 * - OUR storefront is multi-tenant (serves many merchants by slug)
 * - External customers are single-tenant (have their own API key)
 *
 * For our storefront:
 * - Catalog/products: public read-only route (scoped by merchantId param)
 * - Conversations/messages: capability returned when the conversation is created
 * - Cart: internal route (scoped by merchantId)
 * - Settings: loaded via SSR (server-client.ts)
 *
 * For external customers consuming our headless API:
 * - Everything goes through /v1 with their API key
 * - They DON'T use this file — they use the SDK (zyon-sdk)
 *
 * This file is the STOREFRONT's integration layer. Customers use the SDK.
 */

import { aiVisitorToken, conversationFetch, rememberAiVisitorToken, rememberConversationAccess } from "../conversation-access";
import { getValidBuyer } from "../buyer-auth";
import { apiCall } from "@/lib/services/http";
import type { ConversationAttachment, CrossSellInterstitialData } from "@/lib/viewmodels/useConversationViewModel/types";

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
async function safeFetch(url: string, options?: RequestInit, conversationId?: string) {
  const request = {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...options?.headers,
    },
  };
  const res = await (conversationId ? conversationFetch(conversationId, url, request) : fetch(url, request));
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
      `${API_BASE}/storefront/catalog/${encodeURIComponent(merchantId)}/products${qs ? `?${qs}` : ""}`,
    );
    return {
      products: result.products ?? [],
      nextCursor: result.nextCursor,
    };
  },
  async get(merchantId: string, productId: string): Promise<Product | null> {
    const result = await safeFetch(
      `${API_BASE}/storefront/catalog/${encodeURIComponent(merchantId)}/products/${encodeURIComponent(productId)}`,
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
// ─── Checkout / Conversations (conversation capability) ──

const conversationStarts = new Map<string, Promise<any>>();
export const checkoutApi = {
  async preCheckoutSuggestions(merchantId: string, cartId: string): Promise<CrossSellInterstitialData> {
    return safeFetch(`${API_BASE}/storefront/cart/${encodeURIComponent(cartId)}/pre-checkout-suggestions?merchantId=${encodeURIComponent(merchantId)}`,
      { cache: "no-store", signal: AbortSignal.timeout(8000) }, cartId);
  },
  async create(data: {
    merchantId: string;
    customerId?: string;
    items?: any[];
  }): Promise<any> {
    const key = JSON.stringify(data);
    const pending = conversationStarts.get(key);
    if (pending) return pending;
    const start = (async () => {
      const result = await safeFetch("/api/storefront-conversations", {
        method: "POST",
        body: JSON.stringify({
          merchant_id: data.merchantId,
          customer_id: data.customerId,
          items: data.items,
          ai_user_token: aiVisitorToken(),
          buyer_access_token: getValidBuyer()?.token,
        }),
      });
      if (typeof result.conversation_id !== "string" || typeof result.conversation_token !== "string") throw new Error("missing_conversation_access");
      rememberConversationAccess(result.conversation_id, result.conversation_token);
      if (typeof result.ai_user_token === "string") rememberAiVisitorToken(result.ai_user_token);
      return result;
    })();
    conversationStarts.set(key, start);
    try { return await start; } finally { conversationStarts.delete(key); }
  },

  async generateNudge(conversationId: string, merchantId: string, trigger: "idle_30_seconds" | "exit_intent_detected", stage: "cart" | "browsing", fallback: string): Promise<{ message: string }> {
    return safeFetch(`${API_BASE}/storefront/nudge`, {
      method: "POST",
      body: JSON.stringify({ conversation_id: conversationId, merchant_id: merchantId, trigger, stage, fallback }),
    }, conversationId);
  },

  async sendMessage(checkoutId: string, text: string, options?: {
    token?: string;
    merchantId?: string;
    cartId?: string;
    history?: any[];
    variantId?: string;
    attachment?: ConversationAttachment;
    voiceTurnToken?: string;
  }): Promise<any> {
    return safeFetch(`${API_BASE}/storefront/conversations/${checkoutId}/messages`, {
      method: "POST",
      headers: options?.token ? { "X-Buyer-Authorization": `Bearer ${options.token}` } : undefined,
      body: JSON.stringify({
        merchant_id: options?.merchantId,
        user_message: text,
        cart_id: checkoutId,
        history: options?.history,
        variant_id: options?.variantId || undefined,
        attachment: options?.attachment,
        voice_turn_token: options?.voiceTurnToken,
      }),
    }, checkoutId);
  },

  async getOneBuyClick(conversationId: string, buyerToken?: string): Promise<{
    enabled: boolean;
    status: string;
    shippingPreference: "fastest" | "cheapest";
    paymentPreference: "pix" | "card";
    preferencesConfigured: boolean;
  }> {
    return safeFetch(
      `${API_BASE}/storefront/conversations/${encodeURIComponent(conversationId)}/one-buy-click`,
      { headers: buyerToken ? { "X-Buyer-Authorization": `Bearer ${buyerToken}` } : undefined },
      conversationId,
    );
  },

  async configureOneBuyClick(conversationId: string, enabled: boolean, buyerToken?: string): Promise<{
    enabled: boolean;
    status: string;
    shippingPreference: "fastest" | "cheapest";
    paymentPreference: "pix" | "card";
    preferencesConfigured: boolean;
  }> {
    return safeFetch(
      `${API_BASE}/storefront/conversations/${encodeURIComponent(conversationId)}/one-buy-click`,
      {
        method: "PATCH",
        headers: buyerToken ? { "X-Buyer-Authorization": `Bearer ${buyerToken}` } : undefined,
        body: JSON.stringify({ enabled }),
      },
      conversationId,
    );
  },

  async saveQuickPurchasePreferences(input: {
    shippingPreference: "fastest" | "cheapest";
    paymentPreference: "pix" | "card";
  }): Promise<void> {
    await apiCall("/buyer/me/preferences", {
      method: "PATCH",
      body: JSON.stringify({
        one_buy_click_enabled: true,
        shipping_preference: input.shippingPreference,
        payment_preference: input.paymentPreference,
        purchase_preferences_configured: true,
      }),
    });
  },
};
export const cartApi = {
  async requestBudget(cartId: string, merchantId: string, data: { customerName: string; customerEmail: string; customerPhone: string; note?: string }): Promise<{ id: string; status: string }> {
    return safeFetch(`${API_BASE}/storefront/budget-requests`, {
      method: "POST",
      body: JSON.stringify({ cart_id: cartId, merchant_id: merchantId, customer_name: data.customerName, customer_email: data.customerEmail, customer_phone: data.customerPhone, note: data.note }),
    }, cartId);
  },
  async get(cartId: string, merchantId: string): Promise<any> {
    return safeFetch(
      `${API_BASE}/storefront/cart/${encodeURIComponent(cartId)}?merchantId=${encodeURIComponent(merchantId)}`,
      undefined, cartId,
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
        body: JSON.stringify({ quantity }),
      },
      cartId,
    );
  },
  async clear(cartId: string, merchantId: string): Promise<any> {
    return safeFetch(
      `${API_BASE}/storefront/cart/${encodeURIComponent(cartId)}/clear?merchantId=${encodeURIComponent(merchantId)}`,
      { method: "POST" }, cartId,
    );
  },
};
export const intentMemoryApi = {
  async getConsent(buyerToken: string): Promise<any> {
    return safeFetch(`${API_BASE}/buyer/consent/intent-memory`, {
      headers: { Authorization: `Bearer ${buyerToken}` },
    });
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
