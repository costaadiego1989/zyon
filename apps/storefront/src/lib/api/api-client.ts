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

import { conversationFetch, rememberConversationAccess } from "../conversation-access";
import { cloneStorefrontReadUiAction, rememberStorefrontReadUiActionCapability, storefrontReadUiActionRequest } from "../storefront-read-ui-action";
import type { StorefrontReadUiAction } from "@zyon/shared-types";
import { readCartLineSelection, type CartLineSelection } from "../cart-line-selection";
import { apiCall } from "@/lib/services/http";
import type { ConversationAttachment } from "@/lib/viewmodels/useConversationViewModel/types";
import { assertCrossSellQuoteScope, assertCrossSellRequestScope, parseCrossSellAcceptance, parseCrossSellQuote, parseCrossSellSelection } from "../cross-sell-quote";

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
async function safeFetch(url: string, options?: RequestInit | (() => RequestInit), conversationId?: string, replayAuthorizationFailure = true) {
  const request = () => {
    const prepared = typeof options === "function" ? options() : options;
    return {
      ...prepared,
      headers: {
        "Content-Type": "application/json",
        ...prepared?.headers,
      },
    };
  };
  const res = await (conversationId ? conversationFetch(conversationId, url, request, { replayAuthorizationFailure }) : fetch(url, request()));
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
  async create(data: {
    merchantId: string;
    customerId?: string;
    items?: any[];
  }): Promise<any> {
    const key = JSON.stringify(data);
    const merchantId = data.merchantId;
    const pending = conversationStarts.get(key);
    if (pending) return pending;
    const start = (async () => {
      const result = await safeFetch("/api/storefront-conversations", {
        method: "POST",
        body: JSON.stringify({
          merchant_id: merchantId,
          customer_id: data.customerId,
          items: data.items,
        }),
      });
      if (Object.prototype.hasOwnProperty.call(result, "merchant_id") && result.merchant_id !== merchantId) throw new Error("conversation_start_merchant_mismatch");
      if (typeof result.conversation_id !== "string" || typeof result.conversation_token !== "string") throw new Error("missing_conversation_access");
      rememberConversationAccess(result.conversation_id, result.conversation_token);
      rememberStorefrontReadUiActionCapability(result.conversation_id,
        result.merchant_id === merchantId ? result.merchant_id : undefined, result.ui_action_capability);
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
    uiAction?: StorefrontReadUiAction;
    voiceTurnToken?: string;
  }): Promise<any> {
    const hasUiAction = options?.uiAction !== undefined;
    // Reject malformed commands before IO. The transport prepares the body only
    // after learning any successful renewal's protocol support.
    const uiActionSnapshot = hasUiAction ? cloneStorefrontReadUiAction(options.uiAction) : undefined;
    const merchantId = options?.merchantId;
    const buyerAuthorization = options?.token ? `Bearer ${options.token}` : undefined;
    // Freeze the actual JSON semantics before renewal can yield to UI changes.
    // Only capability selection belongs after preflight, never buyer/intent data.
    const bodySnapshot = JSON.parse(JSON.stringify({
      merchant_id: merchantId, user_message: text, cart_id: checkoutId,
      history: options?.history, variant_id: options?.variantId || undefined,
      attachment: options?.attachment,
      voice_turn_token: options?.voiceTurnToken,
    }));
    return safeFetch(`${API_BASE}/storefront/conversations/${checkoutId}/messages`, () => ({
      method: "POST",
      headers: buyerAuthorization ? { "X-Buyer-Authorization": buyerAuthorization } : undefined,
      body: JSON.stringify({
        ...bodySnapshot,
        ...(hasUiAction ? storefrontReadUiActionRequest(checkoutId, merchantId, uiActionSnapshot) : undefined),
      }),
      }), checkoutId, false);
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
/** Dedicated buyer-confirmed route. Never send a quote through chat/LLM tools. */
export const crossSellApi = {
  async quote(merchantId: string, cartId: string, conversationId: string, input: unknown) {
    assertCrossSellRequestScope(merchantId, cartId, conversationId);
    const request = parseCrossSellSelection(input);
    const result = parseCrossSellQuote(await safeFetch(
      `${API_BASE}/storefront/${encodeURIComponent(merchantId)}/cart/${encodeURIComponent(cartId)}/cross-sell/quote`,
      { method: "POST", body: JSON.stringify(request) }, conversationId, false));
    assertCrossSellQuoteScope(result, merchantId, cartId, request);
    return result;
  },
  async accept(merchantId: string, cartId: string, conversationId: string, input: unknown) {
    assertCrossSellRequestScope(merchantId, cartId, conversationId);
    const expectedQuote = parseCrossSellQuote(input);
    assertCrossSellQuoteScope(expectedQuote, merchantId, cartId);
    return parseCrossSellAcceptance(await safeFetch(
      `${API_BASE}/storefront/${encodeURIComponent(merchantId)}/cart/${encodeURIComponent(cartId)}/cross-sell/accept`,
      { method: "POST", body: JSON.stringify({ expectedQuote }) }, conversationId, false), merchantId, cartId);
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
    selection?: CartLineSelection,
  ): Promise<any> {
    return safeFetch(
      `${API_BASE}/storefront/cart/${encodeURIComponent(cartId)}/items/${encodeURIComponent(variantId)}?merchantId=${encodeURIComponent(merchantId)}`,
      {
        method: "PATCH",
        body: JSON.stringify({ quantity, ...readCartLineSelection(selection ?? {}) }),
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
