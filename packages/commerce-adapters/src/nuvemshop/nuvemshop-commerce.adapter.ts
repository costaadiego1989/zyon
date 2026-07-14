import type {
  CommerceCatalogPage,
  CommerceCatalogProduct,
  CommerceCartPort,
  CommerceCatalogPort,
  CommerceConnectionTestPort,
  CommerceOrderPort,
  TrustedCartSnapshot,
} from "../ports.js";
import { NuvemshopRateLimiter } from "./nuvemshop-rate-limiter.js";

/**
 * Nuvemshop (Tiendanube) commerce adapter.
 *
 * Spec: https://tiendanube.github.io/api-documentation/intro
 *
 * Operational notes:
 *   - Auth: Bearer token obtained from the Partner Portal OAuth handshake.
 *   - Mandatory `User-Agent` header; missing returns HTTP 400.
 *   - Base URL: `https://api.tiendanube.com/v1/{store_id}/`.
 *   - Rate limit: 2 req/s sustained, 40 burst, per (store, app).
 *   - Pagination: `?page=N&per_page=M` (max 200). Link header is `next` only.
 *
 * Errors:
 *   401 → token revoked, do not retry.
 *   402 → store subscription lapsed, do not retry.
 *   422 → validation, surface to caller.
 *   429 → backoff per `Retry-After`/`X-RateLimit-Reset`.
 *   5xx → transient, caller retries with backoff.
 */

export type NuvemshopAdapterConfig = {
  storeId: string;
  accessToken: string;
  /** User-Agent string (mandatory). Defaults to "AACP (https://aacp.example)". */
  userAgent?: string;
  /** Inject a custom fetcher (used by tests and HTTP client wrappers). */
  fetchFn?: typeof fetch;
  /**
   * Per-adapter rate limiter. Constructed lazily if not provided so multiple
   * adapters sharing a connection still observe the same logical 2 rps budget.
   */
  rateLimiter?: NuvemshopRateLimiter;
};

export type NuvemshopFetchFn = typeof fetch;

const DEFAULT_API_VERSION = "v1";
const DEFAULT_USER_AGENT = "AACP (https://aacp.example)";
const DEFAULT_CURRENCY = "BRL";
const DEFAULT_PER_PAGE = 50;
const MAX_PER_PAGE = 200;

export class NuvemshopCommerceAdapter
  implements
    CommerceCartPort,
    CommerceOrderPort,
    CommerceCatalogPort,
    CommerceConnectionTestPort
{
  readonly #storeId: string;
  readonly #accessToken: string;
  readonly #userAgent: string;
  readonly #fetch: NuvemshopFetchFn;
  readonly #limiter: NuvemshopRateLimiter;

  constructor(config: NuvemshopAdapterConfig, fetchImpl?: NuvemshopFetchFn) {
    const storeId = config.storeId.trim();
    const accessToken = config.accessToken.trim();
    if (!/^\d+$/.test(storeId)) {
      throw new Error("nuvemshop_store_id_must_be_numeric");
    }
    if (!accessToken) {
      throw new Error("nuvemshop_access_token_required");
    }

    this.#storeId = storeId;
    this.#accessToken = accessToken;
    this.#userAgent = (config.userAgent ?? DEFAULT_USER_AGENT).trim();
    this.#fetch = fetchImpl ?? globalThis.fetch.bind(globalThis);
    this.#limiter = config.rateLimiter ?? new NuvemshopRateLimiter();
  }

  /** Public base URL for this store. Useful for tests + webhook URLs. */
  get baseUrl(): string {
    return `https://api.tiendanube.com/${DEFAULT_API_VERSION}/${this.#storeId}`;
  }

  async validateCart(input: {
    merchantId: string;
    commerceCartRef: string;
  }): Promise<TrustedCartSnapshot> {
    const ref = input.commerceCartRef.trim();
    if (!ref) throw new Error("nuvemshop_cart_ref_required");
    const order = await this.request<NuvemshopOrder>(
      `/orders/${encodeURIComponent(ref)}`,
      { method: "GET" },
      "nuvemshop_validate_cart",
    );
    return mapOrderToTrustedCart(order);
  }

  async createPendingOrder(input: {
    merchantId: string;
    sessionId: string;
    cart: TrustedCartSnapshot;
  }): Promise<{ commerceOrderId: string }> {
    // Nuvemshop requires POST /orders with an explicit contact+products payload.
    // The AACP cart is trusted; we map cart lines to Nuvemshop's expected shape
    // and use merchantId/sessionId as contact placeholders (real merchants
    // override via the merchant's own address book; here we post a minimal
    // pending order with the cart hash as `note`).
    const body = {
      contact_email: `${input.merchantId}@aacp.local`.slice(0, 250),
      products: input.cart.lines.map((line) => ({
        sku: line.sku,
        quantity: line.quantity,
        price: (line.unitPriceCents / 100).toFixed(2),
        name: line.title || line.sku,
      })),
      note: `aacp_session=${input.sessionId};cart_ref=${input.cart.commerceCartRef}`,
      status: "open",
    };
    const order = await this.request<NuvemshopOrder>(
      "/orders",
      { method: "POST", body: JSON.stringify(body) },
      "nuvemshop_create_order",
    );
    return { commerceOrderId: String(order.id) };
  }

  async markOrderPaid(input: {
    merchantId: string;
    commerceOrderId: string;
    paymentReference: string;
  }): Promise<void> {
    // Nuvemshop does not have a "mark paid" endpoint; payment confirmation is
    // typically emitted as an `order/paid` webhook from the merchant's PSP.
    // We surface the payment reference as a note so the merchant can audit it
    // in their admin. Production deployments should rely on Nuvemshop's
    // payment-gateway integration for confirmed status transitions.
    await this.request<void>(
      `/orders/${encodeURIComponent(input.commerceOrderId.trim())}`,
      {
        method: "PUT",
        body: JSON.stringify({
          note: `aacp_paid_ref=${input.paymentReference.trim()}`,
        }),
      },
      "nuvemshop_mark_paid",
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
    const body: Record<string, unknown> = {
      cancelled_at: new Date().toISOString(),
    };
    if (input.reason) body["cancel_reason"] = input.reason.trim();
    if (typeof input.notifyCustomer === "boolean") {
      body["send_buyer_email"] = input.notifyCustomer;
    }
    await this.request<void>(
      `/orders/${encodeURIComponent(input.commerceOrderId.trim())}/cancel`,
      { method: "PUT", body: JSON.stringify(body) },
      "nuvemshop_cancel_order",
      { allowEmpty: true },
    );
  }

  async testConnection() {
    const store = await this.request<NuvemshopStore>(
      "/store",
      { method: "GET" },
      "nuvemshop_test_connection",
    );
    return {
      provider: "nuvemshop" as const,
      storeName: store.name ?? "",
      storeUrl:
        store.url ?? `https://${store.contact ?? ""}`.replace(/\/+$/, ""),
      currency: store.currency ?? DEFAULT_CURRENCY,
    };
  }

  async searchCatalog(input: {
    merchantId: string;
    query?: string;
    limit?: number;
    cursor?: string;
  }): Promise<CommerceCatalogPage> {
    const perPage = Math.max(1, Math.min(input.limit ?? DEFAULT_PER_PAGE, MAX_PER_PAGE));
    const page = parsePage(input.cursor);
    const params = new URLSearchParams({
      page: String(page),
      per_page: String(perPage),
    });
    if (input.query?.trim()) params.set("q", input.query.trim());

    const response = await this.rawRequest(
      `/products?${params.toString()}`,
      { method: "GET" },
      "nuvemshop_catalog_search",
    );
    const rows = (await response.json()) as NuvemshopProduct[];
    const products = await Promise.all(rows.map((product) => mapProduct(product, "BRL")));
    return {
      products,
      nextCursor: rows.length === perPage ? String(page + 1) : null,
    };
  }

  async findCatalogProductBySku(input: {
    merchantId: string;
    sku: string;
  }): Promise<CommerceCatalogProduct | null> {
    const sku = input.sku.trim();
    if (!sku) return null;
    const params = new URLSearchParams({ q: sku, per_page: "1" });
    const response = await this.rawRequest(
      `/products?${params.toString()}`,
      { method: "GET" },
      "nuvemshop_catalog_lookup",
    );
    const rows = (await response.json()) as NuvemshopProduct[];
    const first = rows[0];
    if (!first) return null;
    const currency = await this.fetchDefaultCurrency();
    return mapProduct(first, currency);
  }

  /**
   * Best-effort fetch of the store currency. Used by catalog helpers because
   * Nuvemshop products do not carry a currency field.
   */
  private async fetchDefaultCurrency(): Promise<string> {
    try {
      const store = await this.request<NuvemshopStore>(
        "/store",
        { method: "GET" },
        "nuvemshop_currency_lookup",
      );
      return store.currency ?? DEFAULT_CURRENCY;
    } catch {
      return DEFAULT_CURRENCY;
    }
  }

  private async request<T>(
    path: string,
    init: RequestInit,
    errorCode: string,
    options: { allowEmpty?: boolean } = {},
  ): Promise<T> {
    const response = await this.rawRequest(path, init, errorCode);
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

  private async rawRequest(
    path: string,
    init: RequestInit,
    errorCode: string,
  ): Promise<Response> {
    await this.#limiter.acquire();
    const url = `${this.baseUrl}${path.startsWith("/") ? path : `/${path}`}`;
    const response = await this.#fetch(url, {
      ...init,
      headers: {
        Authorization: `Bearer ${this.#accessToken}`,
        "User-Agent": this.#userAgent,
        Accept: "application/json",
        "Content-Type": "application/json",
        ...(init.headers as Record<string, string> | undefined),
      },
    });
    if (!response.ok) {
      // Read the body once for diagnostics (status + errorCode are surfaced).
      const errText = await response.text().catch(() => "");
      throw new Error(
        `${errorCode}_failed_${response.status}${errText ? `:${errText.slice(0, 256)}` : ""}`,
      );
    }
    return response;
  }
}

function parsePage(cursor?: string): number {
  if (!cursor) return 1;
  const page = Number(cursor);
  if (!Number.isInteger(page) || page < 1) {
    throw new Error("nuvemshop_catalog_cursor_invalid");
  }
  return page;
}

function mapOrderToTrustedCart(order: NuvemshopOrder): TrustedCartSnapshot {
  const currency = order.currency ?? DEFAULT_CURRENCY;
  const lines = (order.products ?? []).map((line) => {
    const quantity = Number(line.quantity ?? 0);
    const unitPriceCents = Math.round(Number(line.price ?? 0) * 100);
    return {
      sku: line.sku ?? "",
      quantity,
      unitPriceCents,
      title: line.name ?? line.sku ?? "",
    };
  });
  const totalCents = lines.reduce(
    (sum, line) => sum + line.unitPriceCents * line.quantity,
    0,
  );
  return {
    currency,
    totalCents,
    lines,
    commerceCartRef: String(order.id),
  };
}

async function mapProduct(
  product: NuvemshopProduct,
  currency: string,
): Promise<CommerceCatalogProduct> {
  const imageUrl = product.images?.[0]?.src;
  const variants = (product.variants ?? []).map((variant) => ({
    id: String(variant.id),
    sku: variant.sku ?? "",
    title: variant.values?.join(" / ") || "Default",
    unitPriceCents: Math.round(Number(variant.price ?? 0) * 100),
    currency,
    inventoryQuantity: variant.stock ?? null,
    availableForSale: (variant.stock ?? 0) > 0,
    imageUrl,
  }));
  if (variants.length === 0) {
    variants.push({
      id: String(product.id),
      sku: product.sku ?? "",
      title: "Default",
      unitPriceCents: Math.round(Number(product.price ?? 0) * 100),
      currency,
      inventoryQuantity: product.stock ?? null,
      availableForSale: (product.stock ?? 0) > 0,
      imageUrl,
    });
  }
  return {
    id: String(product.id),
    title: product.name?.es ?? product.name?.pt ?? product.name?.en ?? "",
    description: product.description?.plain ?? undefined,
    productUrl: product.canonical_url ?? product.href,
    imageUrl,
    category: product.categories?.[0]?.name,
    variants,
  };
}

// --- Nuvemshop wire types (loose subsets; extra fields are ignored). ---

type NuvemshopStore = {
  id?: number;
  name?: string;
  url?: string;
  contact?: string;
  currency?: string;
};

type NuvemshopOrder = {
  id: number;
  currency?: string;
  products?: Array<{
    sku?: string;
    name?: string;
    quantity?: number;
    price?: number;
  }>;
};

type NuvemshopProduct = {
  id: number;
  sku?: string;
  name?: { es?: string; pt?: string; en?: string };
  description?: { plain?: string; html?: string };
  price?: number;
  stock?: number;
  href?: string;
  canonical_url?: string;
  images?: Array<{ src: string }>;
  categories?: Array<{ name: string }>;
  variants?: Array<{
    id: number;
    sku?: string;
    price?: number;
    stock?: number;
    values?: string[];
  }>;
};
