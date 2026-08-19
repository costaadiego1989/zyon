/**
 * INTERNAL API ADAPTER — maintains CURRENT behavior (V1 compat)
 *
 * These adapters call the INTERNAL routes that the storefront currently uses.
 * They implement the SAME INTERFACES as v1-adapters.ts.
 *
 * Purpose: feature flag controls which adapter is active.
 * With flag OFF → InternalXxxRepository (current behavior, zero risk)
 * With flag ON  → V1XxxRepository (new v1 path)
 *
 * This is the SAFETY NET. V1 storefront keeps working via these adapters.
 */

import type {
  CatalogRepository,
  CartRepository,
  ConversationRepository,
  SettingsRepository,
} from "./api";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:3009";

// ─────────────────────────────────────────────────────────────
// CatalogRepository — INTERNAL (current behavior)
// ─────────────────────────────────────────────────────────────

export class InternalCatalogRepository implements CatalogRepository {
  private merchantId: string;

  constructor(merchantId: string) {
    this.merchantId = merchantId;
  }

  async listProducts(params?: {
    search?: string;
    limit?: number;
    cursor?: string;
  }): Promise<any[]> {
    const searchParams = new URLSearchParams();
    if (params?.search) searchParams.set("q", params.search);
    if (params?.limit) searchParams.set("limit", String(params.limit));

    const qs = searchParams.toString();
    const url = `${API_BASE}/merchants/${this.merchantId}/products${qs ? `?${qs}` : ""}`;

    const res = await fetch(url, { credentials: "include" });
    if (!res.ok) return [];

    return res.json(); // Internal returns raw array, no envelope
  }

  async getProduct(id: string): Promise<any> {
    const res = await fetch(`${API_BASE}/merchants/${this.merchantId}/products/${id}`, {
      credentials: "include",
    });
    if (!res.ok) return null;
    return res.json();
  }
}

// ─────────────────────────────────────────────────────────────
// SettingsRepository — INTERNAL (current behavior)
// ─────────────────────────────────────────────────────────────

export class InternalSettingsRepository implements SettingsRepository {
  private merchantId: string;

  constructor(merchantId: string) {
    this.merchantId = merchantId;
  }

  async getCheckoutSettings(): Promise<any> {
    const res = await fetch(
      `${API_BASE}/checkout-settings/widget-config?merchantId=${encodeURIComponent(this.merchantId)}`,
    );
    if (!res.ok) return null;
    return res.json(); // Internal returns raw object
  }

  async getStoreSettings(): Promise<any> {
    const res = await fetch(
      `${API_BASE}/storefront/${this.merchantId}/config`,
      { next: { revalidate: 60 } },
    );
    if (!res.ok) return null;
    return res.json();
  }
}

// ─────────────────────────────────────────────────────────────
// CartRepository — INTERNAL (current behavior)
// ─────────────────────────────────────────────────────────────

export class InternalCartRepository implements CartRepository {
  private merchantId: string;

  constructor(merchantId: string) {
    this.merchantId = merchantId;
  }

  async get(cartId: string): Promise<any> {
    const res = await fetch(
      `${API_BASE}/storefront/cart/${encodeURIComponent(cartId)}?merchantId=${encodeURIComponent(this.merchantId)}`,
    );
    if (!res.ok) return null;
    return res.json();
  }

  async updateItem(input: {
    cartId: string;
    variantId: string;
    quantity: number;
  }): Promise<any> {
    const res = await fetch(
      `${API_BASE}/storefront/cart/${encodeURIComponent(input.cartId)}/items/${encodeURIComponent(input.variantId)}`,
      {
        method: input.quantity === 0 ? "DELETE" : "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ quantity: input.quantity }),
      },
    );
    if (!res.ok) throw new Error(`cart.updateItem failed: ${res.status}`);
    return res.json();
  }

  async clear(cartId: string): Promise<void> {
    // Internal API doesn't have a cart clear — noop
    void cartId;
  }
}

// ─────────────────────────────────────────────────────────────
// ConversationRepository — INTERNAL (current behavior)
// ─────────────────────────────────────────────────────────────

export class InternalConversationRepository implements ConversationRepository {
  private token: string;

  constructor(embedToken: string) {
    this.token = embedToken;
  }

  async create(input: {
    merchantId: string;
    customerId: string;
  }): Promise<any> {
    const res = await fetch(`${API_BASE}/storefront/conversations`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.token}`,
      },
      body: JSON.stringify({
        merchant_id: input.merchantId,
        customer_id: input.customerId,
      }),
    });
    if (!res.ok) throw new Error(`conversation.create failed: ${res.status}`);
    return res.json();
  }

  async sendMessage(input: {
    conversationId: string;
    text: string;
  }): Promise<any> {
    const res = await fetch(
      `${API_BASE}/storefront/conversations/${input.conversationId}/messages`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.token}`,
        },
        body: JSON.stringify({ text: input.text }),
      },
    );
    if (!res.ok) throw new Error(`conversation.sendMessage failed: ${res.status}`);
    return res.json();
  }

  async getMessages(conversationId: string): Promise<any[]> {
    const res = await fetch(
      `${API_BASE}/storefront/conversations/${conversationId}`,
      {
        headers: { Authorization: `Bearer ${this.token}` },
      },
    );
    if (!res.ok) return [];
    const data = await res.json();
    return data.messages ?? [];
  }
}
