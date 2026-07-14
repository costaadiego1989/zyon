import type {
  CommerceCatalogPage,
  CommerceCatalogPort,
  CommerceCatalogProduct,
  CommerceConnectionHealth,
  CommerceConnectionTestPort,
  CommerceCartPort,
  CommerceOrderPort,
  TrustedCartSnapshot,
} from "../ports.js";

export type WooCommerceAdapterConfig = {
  storeUrl: string;
  consumerKey: string;
  consumerSecret: string;
};

export type WooCommerceFetchFn = typeof fetch;

export class WooCommerceCommerceAdapter
  implements
    CommerceCartPort,
    CommerceOrderPort,
    CommerceCatalogPort,
    CommerceConnectionTestPort
{
  readonly #storeUrl: string;
  readonly #consumerKey: string;
  readonly #consumerSecret: string;
  readonly #fetch: WooCommerceFetchFn;
  #currencyPromise?: Promise<string>;

  constructor(
    config: WooCommerceAdapterConfig,
    fetchImpl?: WooCommerceFetchFn,
  ) {
    this.#storeUrl = normalizeStoreUrl(config.storeUrl);
    this.#consumerKey = config.consumerKey.trim();
    this.#consumerSecret = config.consumerSecret.trim();
    this.#fetch = fetchImpl ?? globalThis.fetch.bind(globalThis);

    if (!this.#storeUrl) {
      throw new Error("woocommerce_store_url_required");
    }
    if (!this.#consumerKey || !this.#consumerSecret) {
      throw new Error("woocommerce_credentials_required");
    }
  }

  async validateCart(input: {
    merchantId: string;
    commerceCartRef: string;
  }): Promise<TrustedCartSnapshot> {
    const order = await this.request<WooOrder>(
      `/orders/${encodeURIComponent(input.commerceCartRef.trim())}`,
      { method: "GET" },
      "woocommerce_validate_cart",
    );
    return {
      currency: order.currency,
      totalCents: moneyToCents(order.total),
      commerceCartRef: String(order.id),
      lines: order.line_items.map((line) => ({
        sku: line.sku,
        quantity: line.quantity,
        unitPriceCents:
          line.quantity > 0
            ? Math.round(moneyToCents(line.total) / line.quantity)
            : 0,
        title: line.name,
      })),
    };
  }

  async createPendingOrder(input: {
    merchantId: string;
    sessionId: string;
    cart: TrustedCartSnapshot;
  }): Promise<{ commerceOrderId: string }> {
    return { commerceOrderId: input.cart.commerceCartRef };
  }

  async markOrderPaid(input: {
    merchantId: string;
    commerceOrderId: string;
    paymentReference: string;
  }): Promise<void> {
    await this.request(
      `/orders/${encodeURIComponent(input.commerceOrderId.trim())}`,
      {
        method: "PUT",
        body: JSON.stringify({
          status: "processing",
          transaction_id: input.paymentReference.trim(),
          set_paid: true,
        }),
      },
      "woocommerce_mark_paid",
    );
  }

  async cancelOrder(input: {
    merchantId: string;
    commerceOrderId: string;
    reason: string;
    notifyCustomer?: boolean;
    restock?: boolean;
  }): Promise<void> {
    await this.request(
      `/orders/${encodeURIComponent(input.commerceOrderId.trim())}`,
      {
        method: "PUT",
        body: JSON.stringify({ status: "cancelled" }),
      },
      "woocommerce_cancel_order",
    );
  }

  async testConnection(): Promise<CommerceConnectionHealth> {
    // Use authenticated /system_status endpoint to validate API credentials
    // (not just the public /wp-json root which doesn't require auth).
    const systemStatus = await this.request<WooSystemStatus>(
      "/system_status",
      { method: "GET" },
      "woocommerce_system_status",
    );
    const storeName =
      systemStatus.environment?.site_title ??
      systemStatus.settings?.store_name ??
      "";
    const storeUrl =
      systemStatus.environment?.site_url ?? this.#storeUrl;
    const currency =
      systemStatus.settings?.currency ?? await this.currency();
    return {
      provider: "woocommerce",
      storeName,
      storeUrl,
      currency,
    };
  }

  async searchCatalog(input: {
    merchantId: string;
    query?: string;
    limit?: number;
    cursor?: string;
  }): Promise<CommerceCatalogPage> {
    const perPage = Math.max(1, Math.min(input.limit ?? 20, 100));
    const page = parsePage(input.cursor);
    const query = new URLSearchParams({
      status: "publish",
      per_page: String(perPage),
      page: String(page),
    });
    if (input.query?.trim()) query.set("search", input.query.trim());

    const [response, currency] = await Promise.all([
      this.rawRequest(
        `/products?${query.toString()}`,
        { method: "GET" },
        "woocommerce_catalog_search",
      ),
      this.currency(),
    ]);
    const rows = (await response.json()) as WooProduct[];
    const totalPages = Number(response.headers.get("x-wp-totalpages") ?? page);
    const products = await Promise.all(
      rows.map((product) => this.mapProduct(product, currency)),
    );
    return {
      products,
      nextCursor: page < totalPages ? String(page + 1) : null,
    };
  }

  async findCatalogProductBySku(input: {
    merchantId: string;
    sku: string;
  }): Promise<CommerceCatalogProduct | null> {
    const sku = input.sku.trim();
    if (!sku) return null;
    const query = new URLSearchParams({
      sku,
      status: "publish",
      per_page: "1",
    });
    const [products, currency] = await Promise.all([
      this.request<WooProduct[]>(
        `/products?${query.toString()}`,
        { method: "GET" },
        "woocommerce_catalog_lookup",
      ),
      this.currency(),
    ]);
    return products[0] ? this.mapProduct(products[0], currency) : null;
  }

  private async mapProduct(
    product: WooProduct,
    currency: string,
  ): Promise<CommerceCatalogProduct> {
    const imageUrl = product.images[0]?.src;
    const variants =
      product.type === "variable" && product.variations.length > 0
        ? await this.request<WooVariation[]>(
            `/products/${product.id}/variations?per_page=100`,
            { method: "GET" },
            "woocommerce_variations",
          )
        : [];

    return {
      id: String(product.id),
      title: product.name,
      description: stripHtml(product.short_description || product.description),
      productUrl: product.permalink,
      imageUrl,
      category: product.categories[0]?.name,
      variants:
        variants.length > 0
          ? variants.map((variant) => ({
              id: String(variant.id),
              sku: variant.sku,
              title: variationTitle(variant),
              unitPriceCents: moneyToCents(
                variant.price || variant.regular_price,
              ),
              currency,
              inventoryQuantity: variant.stock_quantity,
              availableForSale: variant.stock_status === "instock",
              imageUrl: variant.image?.src ?? imageUrl,
            }))
          : [
              {
                id: String(product.id),
                sku: product.sku,
                title: "Default",
                unitPriceCents: moneyToCents(
                  product.price || product.regular_price,
                ),
                currency,
                inventoryQuantity: product.stock_quantity,
                availableForSale: product.stock_status === "instock",
                imageUrl,
              },
            ],
    };
  }

  private async request<T>(
    path: string,
    init: RequestInit,
    errorCode: string,
  ): Promise<T> {
    const response = await this.rawRequest(path, init, errorCode);
    return (await response.json()) as T;
  }

  private async rawRequest(
    path: string,
    init: RequestInit,
    errorCode: string,
  ): Promise<Response> {
    const response = await this.#fetch(
      `${this.#storeUrl}/wp-json/wc/v3${path}`,
      {
        ...init,
        headers: {
          Authorization: `Basic ${Buffer.from(
            `${this.#consumerKey}:${this.#consumerSecret}`,
          ).toString("base64")}`,
          "Content-Type": "application/json",
          ...init.headers,
        },
      },
    );
    if (!response.ok) {
      throw new Error(`${errorCode}_failed_${response.status}`);
    }
    return response;
  }

  private async publicRequest<T>(
    path: string,
    errorCode: string,
  ): Promise<T> {
    const response = await this.#fetch(`${this.#storeUrl}${path}`, {
      method: "GET",
    });
    if (!response.ok) {
      throw new Error(`${errorCode}_failed_${response.status}`);
    }
    return (await response.json()) as T;
  }

  private currency(): Promise<string> {
    this.#currencyPromise ??= this.request<WooSetting>(
      "/settings/general/woocommerce_currency",
      { method: "GET" },
      "woocommerce_currency",
    ).then((setting) => String(setting.value || "BRL"));
    return this.#currencyPromise;
  }
}

function normalizeStoreUrl(value: string): string {
  const normalized = value.trim().replace(/\/+$/, "");
  if (!normalized) return "";
  const url = new URL(normalized);
  if (url.protocol !== "https:") {
    throw new Error("woocommerce_https_required");
  }
  return url.origin + url.pathname.replace(/\/+$/, "");
}

function parsePage(cursor?: string): number {
  if (!cursor) return 1;
  const page = Number(cursor);
  if (!Number.isInteger(page) || page < 1) {
    throw new Error("woocommerce_catalog_cursor_invalid");
  }
  return page;
}

function moneyToCents(value: string | number): number {
  return Math.round(Number(value || 0) * 100);
}

function stripHtml(value: string): string | undefined {
  const text = value.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  return text || undefined;
}

function variationTitle(variation: WooVariation): string {
  const title = variation.attributes
    .map((attribute) => attribute.option)
    .filter(Boolean)
    .join(" / ");
  return title || "Default";
}

type WooSite = { name: string; url: string };
type WooSetting = { value?: string };
type WooSystemStatus = {
  environment?: {
    site_title?: string;
    site_url?: string;
    wc_version?: string;
  };
  settings?: {
    store_name?: string;
    currency?: string;
  };
};
type WooOrder = {
  id: number;
  currency: string;
  total: string;
  line_items: Array<{
    name: string;
    sku: string;
    quantity: number;
    total: string;
  }>;
};
type WooImage = { src: string };
type WooProduct = {
  id: number;
  name: string;
  type: string;
  sku: string;
  price: string;
  regular_price: string;
  permalink: string;
  description: string;
  short_description: string;
  stock_quantity: number | null;
  stock_status: string;
  images: WooImage[];
  categories: Array<{ name: string }>;
  variations: number[];
};
type WooVariation = {
  id: number;
  sku: string;
  price: string;
  regular_price: string;
  stock_quantity: number | null;
  stock_status: string;
  image?: WooImage | null;
  attributes: Array<{ option: string }>;
};
