import type {
  CommerceCartPort,
  CommerceOrderPort,
  TrustedCartSnapshot,
  TrustedCartLine
} from "../ports.js";

export type ShopifyCommerceAdapterConfig = {
  shopDomain: string;
  adminAccessToken: string;
  apiVersion?: string;
};

export type ShopifyFetchFn = typeof fetch;

function normalizeShopDomain(shopDomain: string): string {
  return shopDomain.trim().replace(/^https?:\/\//, "").replace(/\/+$/, "");
}

function adminHeaders(adminAccessToken: string): HeadersInit {
  return {
    "Content-Type": "application/json",
    "X-Shopify-Access-Token": adminAccessToken
  };
}

export class ShopifyCommerceAdapter implements CommerceCartPort, CommerceOrderPort {
  readonly #domain: string;
  readonly #version: string;
  readonly #token: string;
  readonly #fetch: ShopifyFetchFn;

  constructor(config: ShopifyCommerceAdapterConfig, fetchImpl?: ShopifyFetchFn) {
    this.#domain = normalizeShopDomain(config.shopDomain);
    this.#token = config.adminAccessToken.trim();
    this.#version = config.apiVersion?.trim() || "2025-10";
    this.#fetch = fetchImpl ?? globalThis.fetch.bind(globalThis);

    if (!this.#domain) throw new Error("shopify_commerce_shop_domain_required");
    if (!this.#token) throw new Error("shopify_commerce_admin_token_required");
  }

  private adminUrl(resourcePath: string): string {
    const path = resourcePath.startsWith("/") ? resourcePath : `/${resourcePath}`;
    return `https://${this.#domain}/admin/api/${this.#version}${path}`;
  }

  async validateCart(input: {
    merchantId: string;
    commerceCartRef: string;
  }): Promise<TrustedCartSnapshot> {
    const ref = encodeURIComponent(input.commerceCartRef.trim());
    const url = this.adminUrl(`/cart_validations/${ref}.json`);
    const response = await this.#fetch(url, {
      method: "GET",
      headers: adminHeaders(this.#token)
    });
    if (!response.ok) {
      throw new Error(`shopify_validate_cart_failed_${response.status}`);
    }
    const payload = (await response.json()) as CartValidationFixture;
    return mapTrustedFromFixture(payload);
  }

  async createPendingOrder(input: {
    merchantId: string;
    sessionId: string;
    cart: TrustedCartSnapshot;
  }): Promise<{ commerceOrderId: string }> {
    const url = this.adminUrl("/draft_orders.json");
    const body = {
      draft_order: {
        note: `AACP checkout session ${input.sessionId}`,
        currency: input.cart.currency,
        line_items: input.cart.lines.map((line) => ({
          sku: line.sku,
          quantity: line.quantity,
          price: centsToMoneyString(line.unitPriceCents),
          title: line.title
        }))
      }
    };

    const response = await this.#fetch(url, {
      method: "POST",
      headers: adminHeaders(this.#token),
      body: JSON.stringify(body)
    });
    if (!response.ok) {
      throw new Error(`shopify_draft_order_failed_${response.status}`);
    }
    const json = (await response.json()) as { draft_order?: { id?: number } };
    const id = json.draft_order?.id;
    if (typeof id !== "number") throw new Error("shopify_draft_order_id_missing");
    return { commerceOrderId: String(id) };
  }

  async markOrderPaid(input: {
    merchantId: string;
    commerceOrderId: string;
    paymentReference: string;
  }): Promise<void> {
    const orderId = input.commerceOrderId.trim();
    const url = this.adminUrl(`/orders/${encodeURIComponent(orderId)}/transactions.json`);
    const body = {
      transaction: {
        kind: "capture",
        status: "success",
        gateway: "manual",
        source_name: `aacp:${input.paymentReference.trim()}`
      }
    };

    const response = await this.#fetch(url, {
      method: "POST",
      headers: adminHeaders(this.#token),
      body: JSON.stringify(body)
    });
    if (!response.ok) {
      throw new Error(`shopify_mark_paid_failed_${response.status}`);
    }
  }
}

type CartValidationFixture = {
  currency: string;
  total_cents: number;
  commerce_cart_ref: string;
  lines: Array<{
    sku: string;
    quantity: number;
    unit_price_cents: number;
    title: string;
  }>;
};

function centsToMoneyString(cents: number): string {
  return (cents / 100).toFixed(2);
}

function mapTrustedFromFixture(fixture: CartValidationFixture): TrustedCartSnapshot {
  const lines: TrustedCartLine[] = fixture.lines.map((l) => ({
    sku: l.sku,
    quantity: l.quantity,
    unitPriceCents: l.unit_price_cents,
    title: l.title
  }));

  return {
    currency: fixture.currency,
    totalCents: fixture.total_cents,
    commerceCartRef: fixture.commerce_cart_ref,
    lines
  };
}
