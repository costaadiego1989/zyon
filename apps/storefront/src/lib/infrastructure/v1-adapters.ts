/**
 * V1 API ADAPTER — implements ports via /v1 public API
 *
 * This adapter speaks to our own headless API the same way a PHP or React Native
 * customer would. Storefront dogfoods the API.
 *
 * Auth: server-side API key injected via Next.js API proxy route.
 * Client components use /api/v1/[path] proxy — never expose keys.
 */

import type {
  CatalogRepository,
  CartRepository,
  ConversationRepository,
  SettingsRepository,
  ApiResponse,
} from "./api";
import { unwrapApiResponse } from "./api";

const V1_PROXY = "/api/v1"; // Next.js API route proxies to v1 API

// ─────────────────────────────────────────────────────────────
// CatalogRepository — v1 implementation
// ─────────────────────────────────────────────────────────────

export class V1CatalogRepository implements CatalogRepository {
  async listProducts(params?: {
    search?: string;
    limit?: number;
    cursor?: string;
  }): Promise<any[]> {
    const searchParams = new URLSearchParams();
    if (params?.search) searchParams.set("search", params.search);
    if (params?.limit) searchParams.set("limit", String(params.limit));
    if (params?.cursor) searchParams.set("cursor", params.cursor);

    const qs = searchParams.toString();
    const url = `${V1_PROXY}/products${qs ? `?${qs}` : ""}`;

    const res = await fetch(url);
    if (!res.ok) throw new Error(`catalog.listProducts failed: ${res.status}`);

    const envelope: ApiResponse<any[]> = await res.json();
    return unwrapApiResponse(envelope);
  }

  async getProduct(id: string): Promise<any> {
    const res = await fetch(`${V1_PROXY}/products/${id}`);
    if (!res.ok) throw new Error(`catalog.getProduct failed: ${res.status}`);

    const envelope: ApiResponse<any> = await res.json();
    return unwrapApiResponse(envelope);
  }
}

// ─────────────────────────────────────────────────────────────
// SettingsRepository — v1 implementation
// ─────────────────────────────────────────────────────────────

export class V1SettingsRepository implements SettingsRepository {
  async getCheckoutSettings(): Promise<any> {
    const res = await fetch(`${V1_PROXY}/settings/checkout`);
    if (!res.ok) throw new Error(`settings.checkout failed: ${res.status}`);

    const envelope: ApiResponse<any> = await res.json();
    return unwrapApiResponse(envelope);
  }

  async getStoreSettings(): Promise<any> {
    const res = await fetch(`${V1_PROXY}/settings/store`);
    if (!res.ok) throw new Error(`settings.store failed: ${res.status}`);

    const envelope: ApiResponse<any> = await res.json();
    return unwrapApiResponse(envelope);
  }
}

// ─────────────────────────────────────────────────────────────
// CartRepository — v1 implementation
// ─────────────────────────────────────────────────────────────

export class V1CartRepository implements CartRepository {
  async get(checkoutId: string): Promise<any> {
    const res = await fetch(`${V1_PROXY}/checkouts/${checkoutId}`);
    if (!res.ok) throw new Error(`cart.get failed: ${res.status}`);

    const envelope: ApiResponse<any> = await res.json();
    return unwrapApiResponse(envelope);
  }

  async updateItem(input: {
    cartId: string;
    variantId: string;
    quantity: number;
  }): Promise<any> {
    const res = await fetch(`${V1_PROXY}/checkouts/${input.cartId}/cart`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        items: [{ variant_id: input.variantId, quantity: input.quantity }],
      }),
    });
    if (!res.ok) throw new Error(`cart.updateItem failed: ${res.status}`);

    const envelope: ApiResponse<any> = await res.json();
    return unwrapApiResponse(envelope);
  }

  async clear(checkoutId: string): Promise<void> {
    await fetch(`${V1_PROXY}/checkouts/${checkoutId}/cart`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items: [] }),
    });
  }
}

// ─────────────────────────────────────────────────────────────
// ConversationRepository — v1 implementation
// ─────────────────────────────────────────────────────────────

export class V1ConversationRepository implements ConversationRepository {
  async create(input: {
    merchantId: string;
    customerId: string;
  }): Promise<any> {
    const res = await fetch(`${V1_PROXY}/checkouts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        merchant_id: input.merchantId,
        customer_id: input.customerId,
      }),
    });
    if (!res.ok) throw new Error(`conversation.create failed: ${res.status}`);

    const envelope: ApiResponse<any> = await res.json();
    return unwrapApiResponse(envelope);
  }

  async sendMessage(input: {
    conversationId: string;
    text: string;
  }): Promise<any> {
    const res = await fetch(
      `${V1_PROXY}/checkouts/${input.conversationId}/messages`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: input.text }),
      },
    );
    if (!res.ok) throw new Error(`conversation.sendMessage failed: ${res.status}`);

    const envelope: ApiResponse<any> = await res.json();
    return unwrapApiResponse(envelope);
  }

  async getMessages(conversationId: string): Promise<any[]> {
    const res = await fetch(`${V1_PROXY}/checkouts/${conversationId}`);
    if (!res.ok) throw new Error(`conversation.getMessages failed: ${res.status}`);

    const envelope: ApiResponse<any> = await res.json();
    const checkout = unwrapApiResponse(envelope);
    return checkout.messages ?? [];
  }
}
