import type {
  CommerceCatalogPage,
  CommerceCatalogProduct,
  CommerceConnectionHealth,
  CommerceCartPort,
  CommerceCatalogPort,
  CommerceConnectionTestPort,
  CommerceOrderPort,
  TrustedCartSnapshot,
  TrustedCartLine
} from "../ports.js";
import { VtexRateLimiter } from "./vtex-rate-limiter.js";
import type {
  VtexApiProduct,
  VtexOrderForm,
  VtexInventoryResponse,
  VtexPriceResponse
} from "./vtex.types.js";

/**
 * VTEX commerce adapter.
 *
 * Spec: https://developers.vtex.com/docs/api-reference
 *
 * Operational notes:
 *   - Auth: X-VTEX-API-AppKey + X-VTEX-API-AppToken (per merchant)
 *   - Base URL: https://{accountName}.vtexcommercestable.com.br
 *   - Rate limit: 800 req/min per merchant
 *   - Catalog: GET /api/catalog_system/pub/products/search
 *   - Cart: PATCH /api/checkout/pub/orderForm/{id}/items
 *   - Order: POST /api/checkout/pub/orderForm/{id}/transaction
 *   - Webhook: Order Hook (push to configured URL)
 *
 * Errors:
 *   401 → invalid credentials, do not retry.
 *   404 → resource not found, do not retry.
 *   429 → rate limit, backoff required.
 *   5xx → transient, caller retries with backoff.
 */

export type VtexCommerceAdapterConfig = {
  accountName: string;
  appKey: string;
  appToken: string;
  /** Inject a custom fetcher (used by tests and HTTP client wrappers). */
  fetchFn?: typeof fetch;
  /** Per-adapter rate limiter (optional). */
  rateLimiter?: VtexRateLimiter;
};

export type VtexFetchFn = typeof fetch;

const DEFAULT_ENVIRONMENT = process.env.VTEX_DEFAULT_ENVIRONMENT ?? "vtexcommercestable.com.br";
const DEFAULT_CURRENCY = "BRL";

export class VtexCommerceAdapter
  implements
    CommerceCartPort,
    CommerceOrderPort,
    CommerceCatalogPort,
    CommerceConnectionTestPort
{
  readonly #accountName: string;
  readonly #appKey: string;
  readonly #appToken: string;
  readonly #fetch: VtexFetchFn;
  readonly #limiter: VtexRateLimiter;
  readonly #baseUrl: string;

  constructor(config: VtexCommerceAdapterConfig, fetchImpl?: VtexFetchFn) {
    const accountName = config.accountName.trim();
    const appKey = config.appKey.trim();
    const appToken = config.appToken.trim();

    if (!accountName) throw new Error("vtex_account_name_required");
    if (!appKey) throw new Error("vtex_app_key_required");
    if (!appToken) throw new Error("vtex_app_token_required");

    this.#accountName = accountName;
    this.#appKey = appKey;
    this.#appToken = appToken;
    this.#fetch = fetchImpl ?? globalThis.fetch.bind(globalThis);
    this.#limiter = config.rateLimiter ?? new VtexRateLimiter();
    this.#baseUrl = `https://${accountName}.${DEFAULT_ENVIRONMENT}`;
  }

  private apiUrl(path: string): string {
    const normalized = path.startsWith("/") ? path : `/${path}`;
    return `${this.#baseUrl}${normalized}`;
  }

  private authHeaders(): HeadersInit {
    return {
      "X-VTEX-API-AppKey": this.#appKey,
      "X-VTEX-API-AppToken": this.#appToken,
      "Content-Type": "application/json",
      Accept: "application/json",
    };
  }

  async testConnection(): Promise<CommerceConnectionHealth> {
    const response = await this.request<{ sku: string }[]>(
      "/api/catalog_system/pvt/sku/stockkeepingunitids?page=1&pagesize=1",
      { method: "GET" },
      "vtex_test_connection",
    );
    return {
      provider: "vtex" as const,
      storeName: this.#accountName,
      storeUrl: this.#baseUrl,
      currency: DEFAULT_CURRENCY,
    };
  }

  async validateCart(input: {
    merchantId: string;
    commerceCartRef: string;
  }): Promise<TrustedCartSnapshot> {
    const cartId = input.commerceCartRef.trim();
    if (!cartId) throw new Error("vtex_cart_ref_required");

    const orderForm = await this.request<VtexOrderForm>(
      `/api/checkout/pub/orderForm/${encodeURIComponent(cartId)}`,
      { method: "GET" },
      "vtex_validate_cart",
    );

    const lines: TrustedCartLine[] = (orderForm.items ?? []).map((item) => ({
      sku: item.skuId ?? "",
      quantity: item.quantity,
      unitPriceCents: Math.round(item.price * 100),
      title: item.name,
      commerceProductId: item.productId,
      commerceVariantId: item.id,
    }));

    return {
      currency: DEFAULT_CURRENCY,
      totalCents: orderForm.value ?? 0,
      lines,
      commerceCartRef: orderForm.orderFormId ?? cartId,
    };
  }

  async searchCatalog(input: {
    merchantId: string;
    query?: string;
    limit?: number;
    cursor?: string;
  }): Promise<CommerceCatalogPage> {
    const from = input.cursor ? parseInt(input.cursor, 10) : 0;
    const to = from + Math.max(1, Math.min(input.limit ?? 20, 100)) - 1;
    const query = input.query?.trim() || "";

    let path = `/api/catalog_system/pub/products/search/?_from=${from}&_to=${to}`;
    if (query) {
      path += `&ft=${encodeURIComponent(query)}`;
    }

    const products = await this.request<VtexApiProduct[]>(
      path,
      { method: "GET" },
      "vtex_catalog_search",
    );

    const mapped = products.map((p) => mapVtexProduct(p));
    return {
      products: mapped,
      nextCursor: mapped.length > 0 ? String(to + 1) : null,
    };
  }

  async findCatalogProductBySku(input: {
    merchantId: string;
    sku: string;
  }): Promise<CommerceCatalogProduct | null> {
    const sku = input.sku.trim();
    if (!sku) return null;

    try {
      const products = await this.request<VtexApiProduct[]>(
        `/api/catalog_system/pub/products/search/?ft=${encodeURIComponent(sku)}&_from=0&_to=0`,
        { method: "GET" },
        "vtex_catalog_lookup",
      );

      const first = products[0];
      if (!first) return null;
      return mapVtexProduct(first);
    } catch {
      return null;
    }
  }

  async createPendingOrder(input: {
    merchantId: string;
    sessionId: string;
    cart: TrustedCartSnapshot;
  }): Promise<{ commerceOrderId: string }> {
    // VTEX requires POST to /api/checkout/pub/orderForm with items.
    // We simulate a pending order by creating an orderForm with the cart items.
    const payload = {
      items: input.cart.lines.map((line) => ({
        id: line.commerceVariantId || line.sku,
        quantity: line.quantity,
        seller: "1", // Seller ID (usually 1 for merchant).
        price: line.unitPriceCents,
      })),
      clientProfileData: {
        email: `aacp-session-${input.sessionId}@aacp.local`,
      },
      customData: {
        customApps: [
          {
            id: "aacp",
            fields: {
              sessionId: input.sessionId,
            },
          },
        ],
      },
    };

    const orderForm = await this.request<VtexOrderForm>(
      "/api/checkout/pub/orderForm",
      {
        method: "POST",
        body: JSON.stringify(payload),
      },
      "vtex_create_pending_order",
    );

    const orderId = orderForm.orderFormId || orderForm.id;
    if (!orderId) throw new Error("vtex_pending_order_id_missing");
    return { commerceOrderId: orderId };
  }

  async markOrderPaid(input: {
    merchantId: string;
    commerceOrderId: string;
    paymentReference: string;
  }): Promise<void> {
    // VTEX payment is typically handled by the gateway. We record the payment
    // reference in a custom field for audit trails. In production, the
    // merchant's Shopify/VTEX gateway flow handles the order confirmation.
    // This is a no-op stub; real integration would finalize the order.
    await this.request<void>(
      `/api/checkout/pub/orderForm/${encodeURIComponent(input.commerceOrderId)}`,
      {
        method: "PATCH",
        body: JSON.stringify({
          customData: {
            customApps: [
              {
                id: "aacp",
                fields: {
                  paymentReference: input.paymentReference,
                },
              },
            ],
          },
        }),
      },
      "vtex_mark_paid",
      { allowEmpty: true },
    );
  }

  async cancelOrder(input: {
    merchantId: string;
    commerceOrderId: string;
    reason: string;
    notifyCustomer?: boolean;
    restock?: boolean;
  }): Promise<void> {
    // VTEX order cancellation is typically handled via the Orders API with
    // a cancellation reason. For pending orders (orderForms not yet converted),
    // we just remove items. For confirmed orders, the merchant's fulfillment
    // system handles cancellation.
    await this.request<void>(
      `/api/checkout/pub/orderForm/${encodeURIComponent(input.commerceOrderId)}/items`,
      {
        method: "DELETE",
        body: JSON.stringify({
          reason: input.reason.trim().slice(0, 255),
        }),
      },
      "vtex_cancel_order",
      { allowEmpty: true },
    );
  }

  private async request<T>(
    path: string,
    init: RequestInit,
    errorCode: string,
    options: { allowEmpty?: boolean } = {},
  ): Promise<T> {
    await this.#limiter.acquire();

    const url = this.apiUrl(path);
    const response = await this.#fetch(url, {
      ...init,
      headers: {
        ...this.authHeaders(),
        ...(init.headers as Record<string, string> | undefined),
      },
    });

    if (response.status === 429) {
      throw new VtexRateLimitError(
        `${errorCode}_throttled_${response.status}`,
        this.#limiter.availableTokens(),
      );
    }

    if (!response.ok) {
      const errText = await response.text().catch(() => "");
      throw new Error(
        `${errorCode}_failed_${response.status}${errText ? `:${errText.slice(0, 256)}` : ""}`,
      );
    }

    if (options.allowEmpty && response.status === 204) {
      return undefined as unknown as T;
    }

    const text = await response.text();
    if (!text) return undefined as unknown as T;

    try {
      return JSON.parse(text) as T;
    } catch {
      throw new Error(`${errorCode}_invalid_json`);
    }
  }
}

export class VtexRateLimitError extends Error {
  readonly availablePoints: number;

  constructor(message: string, availablePoints: number) {
    super(message);
    this.name = "VtexRateLimitError";
    this.availablePoints = availablePoints;
  }
}

function mapVtexProduct(product: VtexApiProduct): CommerceCatalogProduct {
  const items = product.items ?? [];
  const imageUrl = items[0]?.images?.[0]?.imageUrl;

  const variants = items.map((item) => {
    const seller = item.sellers?.[0];
    const offer = seller?.commertialOffer ?? { price: 0, stock: 0 };
    return {
      id: item.itemId,
      sku: item.name,
      title: item.name,
      unitPriceCents: Math.round(offer.price * 100),
      currency: DEFAULT_CURRENCY,
      inventoryQuantity: offer.stock ?? 0,
      availableForSale: (offer.stock ?? 0) > 0,
      imageUrl: item.images?.[0]?.imageUrl ?? imageUrl,
    };
  });

  if (variants.length === 0) {
    variants.push({
      id: product.productId,
      sku: product.productName,
      title: product.productName,
      unitPriceCents: 0,
      currency: DEFAULT_CURRENCY,
      inventoryQuantity: 0,
      availableForSale: false,
      imageUrl,
    });
  }

  return {
    id: product.productId,
    title: product.productName,
    description: product.description,
    productUrl: product.productUrl,
    imageUrl,
    category: product.brand,
    variants,
  };
}
