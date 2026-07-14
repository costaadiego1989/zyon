import type {
  CommerceCatalogPage,
  CommerceCatalogProduct,
  CommerceConnectionHealth,
  CommerceCartPort,
  CommerceCatalogPort,
  CommerceConnectionTestPort,
  CommerceOrderPort,
  TrustedCartSnapshot,
  TrustedCartLine,
} from "../ports.js";
import type {
  TrayCommerceCredentials,
  TrayFetchFn,
  TrayProduct,
  TrayOrder,
  TrayListResponse,
} from "./tray-types.js";
import { TrayOAuthService } from "./tray-oauth.service.js";

export type { TrayCommerceCredentials, TrayFetchFn };

export class TrayCommerceAdapter
  implements
    CommerceCartPort,
    CommerceOrderPort,
    CommerceCatalogPort,
    CommerceConnectionTestPort
{
  readonly #credentials: TrayCommerceCredentials;
  readonly #fetch: TrayFetchFn;
  readonly #oauth: TrayOAuthService;

  constructor(
    credentials: TrayCommerceCredentials,
    fetchImpl?: TrayFetchFn,
  ) {
    if (!credentials.apiAddress) throw new Error("tray_api_address_required");
    if (!credentials.accessToken) throw new Error("tray_access_token_required");
    if (!credentials.refreshToken) throw new Error("tray_refresh_token_required");

    this.#credentials = credentials;
    this.#fetch = fetchImpl ?? globalThis.fetch.bind(globalThis);
    this.#oauth = new TrayOAuthService(credentials, this.#fetch);
  }

  async testConnection(): Promise<CommerceConnectionHealth> {
    const info = await this.request<
      { store_name?: string; currency?: string; id?: number }
    >("/info", { method: "GET" }, "tray_test_connection");
    return {
      provider: "tray",
      storeName: info.store_name ?? "Tray Store",
      storeUrl: this.#credentials.apiAddress,
      currency: info.currency ?? "BRL",
    };
  }

  async searchCatalog(input: {
    merchantId: string;
    query?: string;
    limit?: number;
    cursor?: string;
  }): Promise<CommerceCatalogPage> {
    const limit = Math.max(1, Math.min(input.limit ?? 20, 100));
    const page = parsePage(input.cursor);
    const params = new URLSearchParams({
      limit: String(limit),
      page: String(page),
    });
    if (input.query?.trim()) {
      params.set("filter[name]", input.query.trim());
    }

    const response = await this.request<TrayListResponse<TrayProduct>>(
      `/products?${params.toString()}`,
      { method: "GET" },
      "tray_catalog_search",
    );

    const products = response.result.map((p) => this.mapProduct(p));
    const hasNext = response.paging?.next !== undefined;
    return {
      products,
      nextCursor: hasNext ? String(page + 1) : null,
    };
  }

  async findCatalogProductBySku(input: {
    merchantId: string;
    sku: string;
  }): Promise<CommerceCatalogProduct | null> {
    const sku = input.sku.trim();
    if (!sku) return null;

    const params = new URLSearchParams({
      filter: `[sku]=${sku}`,
      limit: "1",
    });
    const response = await this.request<TrayListResponse<TrayProduct>>(
      `/products?${params.toString()}`,
      { method: "GET" },
      "tray_catalog_lookup",
    );

    return response.result[0] ? this.mapProduct(response.result[0]) : null;
  }

  async validateCart(input: {
    merchantId: string;
    commerceCartRef: string;
  }): Promise<TrustedCartSnapshot> {
    const orderId = input.commerceCartRef.trim();
    if (!orderId) throw new Error("tray_order_id_required");

    const order = await this.request<TrayOrder>(
      `/orders/${encodeURIComponent(orderId)}`,
      { method: "GET" },
      "tray_validate_cart",
    );

    const lines: TrustedCartLine[] = (order.items ?? []).map((item) => ({
      sku: item.sku ?? String(item.id),
      quantity: item.quantity,
      unitPriceCents: moneyToCents(item.price),
      title: item.name,
    }));

    return {
      currency: order.currency ?? "BRL",
      totalCents: moneyToCents(order.total),
      commerceCartRef: String(order.id),
      lines,
    };
  }

  async createPendingOrder(input: {
    merchantId: string;
    sessionId: string;
    cart: TrustedCartSnapshot;
  }): Promise<{ commerceOrderId: string }> {
    const body = {
      number: `AACP-${input.sessionId.slice(0, 12)}`,
      status: "open",
      items: input.cart.lines.map((line) => ({
        product_id: line.sku,
        quantity: line.quantity,
        price: centsToMoneyString(line.unitPriceCents),
      })),
    };

    const response = await this.request<{ id: number }>(
      "/orders",
      {
        method: "POST",
        body: JSON.stringify(body),
      },
      "tray_create_pending_order",
    );

    if (!response.id) throw new Error("tray_order_id_missing");
    return { commerceOrderId: String(response.id) };
  }

  async markOrderPaid(input: {
    merchantId: string;
    commerceOrderId: string;
    paymentReference: string;
  }): Promise<void> {
    const orderId = encodeURIComponent(input.commerceOrderId.trim());
    const body = {
      status: "invoiced",
      note: `Payment reference: ${input.paymentReference}`,
    };

    await this.request(
      `/orders/${orderId}`,
      {
        method: "PUT",
        body: JSON.stringify(body),
      },
      "tray_mark_paid",
    );
  }

  async cancelOrder(input: {
    merchantId: string;
    commerceOrderId: string;
    reason: string;
    notifyCustomer?: boolean;
    restock?: boolean;
  }): Promise<void> {
    const orderId = encodeURIComponent(input.commerceOrderId.trim());
    const body = { status: "cancelled", note: input.reason.trim().slice(0, 255) };

    await this.request(
      `/orders/${orderId}/cancel`,
      {
        method: "PUT",
        body: JSON.stringify(body),
      },
      "tray_cancel_order",
    );
  }

  private mapProduct(product: TrayProduct): CommerceCatalogProduct {
    return {
      id: String(product.id),
      title: product.name,
      description: product.description || undefined,
      productUrl: product.url || undefined,
      imageUrl: product.image || undefined,
      category: product.category?.name || undefined,
      variants: [
        {
          id: String(product.id),
          sku: String(product.id),
          title: "Default",
          unitPriceCents: moneyToCents(product.price),
          currency: "BRL",
          inventoryQuantity: product.quantity,
          availableForSale: product.quantity > 0,
          imageUrl: product.image || undefined,
        },
      ],
    };
  }

  private async request<T>(
    path: string,
    init: RequestInit,
    errorCode: string,
  ): Promise<T> {
    // Check if token needs refresh
    if (this.#oauth.isExpired()) {
      try {
        const refreshed = await this.#oauth.refresh();
        // Update credentials in-memory (in production, caller persists this)
        this.#credentials.accessToken = refreshed.access_token;
        this.#credentials.refreshToken = refreshed.refresh_token;
        this.#credentials.accessTokenExpiresAt =
          refreshed.date_expiration_access_token;
      } catch {
        throw new Error(`${errorCode}_token_refresh_failed`);
      }
    }

    // Inject access token as query param
    const url = new URL(
      path.startsWith("http")
        ? path
        : `${this.#credentials.apiAddress}${path.startsWith("/") ? path : `/${path}`}`,
    );
    url.searchParams.set("access_token", this.#credentials.accessToken);

    const response = await this.#fetch(url.href, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        ...init.headers,
      },
    });

    // Handle Tray-specific errors
    const json = (await response.json()) as Record<string, unknown>;

    // Check for app-level error code 1000 (expired token)
    if (json.code === 1000) {
      throw new Error(`${errorCode}_token_expired`);
    }

    if (!response.ok) {
      throw new Error(`${errorCode}_failed_${response.status}`);
    }

    return json as T;
  }
}

function parsePage(cursor?: string): number {
  if (!cursor) return 1;
  const page = Number(cursor);
  if (!Number.isInteger(page) || page < 1) {
    throw new Error("tray_catalog_cursor_invalid");
  }
  return page;
}

function moneyToCents(value: string | number): number {
  return Math.round(Number(value || 0) * 100);
}

function centsToMoneyString(cents: number): string {
  return (cents / 100).toFixed(2);
}
