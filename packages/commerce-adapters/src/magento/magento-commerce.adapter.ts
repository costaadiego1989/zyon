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

export type MagentoAdapterConfig = {
  baseUrl: string;
  accessToken: string;
  storeCode?: string;
};

export type MagentoFetchFn = typeof fetch;

export class MagentoCommerceAdapter
  implements
    CommerceCartPort,
    CommerceOrderPort,
    CommerceCatalogPort,
    CommerceConnectionTestPort
{
  readonly #baseUrl: string;
  readonly #accessToken: string;
  readonly #storeCode: string;
  readonly #fetch: MagentoFetchFn;

  constructor(
    config: MagentoAdapterConfig,
    fetchImpl?: MagentoFetchFn,
  ) {
    this.#baseUrl = normalizeBaseUrl(config.baseUrl);
    this.#accessToken = config.accessToken.trim();
    this.#storeCode = config.storeCode?.trim() ?? "default";
    this.#fetch = fetchImpl ?? globalThis.fetch.bind(globalThis);

    if (!this.#baseUrl) {
      throw new Error("magento_base_url_required");
    }
    if (!this.#accessToken) {
      throw new Error("magento_credentials_required");
    }
  }

  async validateCart(input: {
    merchantId: string;
    commerceCartRef: string;
  }): Promise<TrustedCartSnapshot> {
    const cartId = input.commerceCartRef.trim();
    if (!cartId) {
      throw new Error("magento_validate_cart_empty_ref");
    }

    const totals = await this.request<MagentoCartTotals>(
      `/guest-carts/${encodeURIComponent(cartId)}/totals`,
      { method: "GET" },
      "magento_validate_cart",
    );

    return {
      currency: totals.quote_currency_code ?? "USD",
      totalCents: moneyToCents(totals.grand_total),
      commerceCartRef: cartId,
      lines: (totals.items ?? []).map((item) => ({
        sku: item.sku,
        quantity: item.quantity,
        unitPriceCents: moneyToCents(item.price),
        title: item.name,
        commerceProductId: item.product_id ? String(item.product_id) : undefined,
        commerceVariantId: undefined,
      })),
    };
  }

  async createPendingOrder(input: {
    merchantId: string;
    sessionId: string;
    cart: TrustedCartSnapshot;
  }): Promise<{ commerceOrderId: string }> {
    const cartId = input.cart.commerceCartRef;
    return { commerceOrderId: cartId };
  }

  async markOrderPaid(input: {
    merchantId: string;
    commerceOrderId: string;
    paymentReference: string;
  }): Promise<void> {
    const cartId = input.commerceOrderId.trim();
    if (!cartId) {
      throw new Error("magento_mark_paid_empty_order_id");
    }

    const paymentMethodNonce = input.paymentReference.trim();
    if (!paymentMethodNonce) {
      throw new Error("magento_mark_paid_empty_nonce");
    }

    const result = await this.request<MagentoPaymentResult>(
      `/guest-carts/${encodeURIComponent(cartId)}/payment-information`,
      {
        method: "POST",
        body: JSON.stringify({
          paymentMethod: {
            method: "braintree",
            additional_data: {
              payment_method_nonce: paymentMethodNonce,
              device_data: "",
            },
          },
          billing_address: {},
        }),
      },
      "magento_mark_paid",
    );

    if (!result.order_id) {
      throw new Error("magento_mark_paid_no_order_id");
    }
  }

  async cancelOrder(input: {
    merchantId: string;
    commerceOrderId: string;
    reason: string;
    notifyCustomer?: boolean;
    restock?: boolean;
  }): Promise<void> {
    const orderId = input.commerceOrderId.trim();
    if (!orderId) {
      throw new Error("magento_cancel_order_empty_id");
    }

    try {
      await this.request(
        `/orders/${encodeURIComponent(orderId)}/cancel`,
        { method: "POST" },
        "magento_cancel_order",
      );
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      if (errorMsg.includes("404") || errorMsg.includes("not_found")) {
        return;
      }
      throw err;
    }
  }

  async testConnection(): Promise<CommerceConnectionHealth> {
    const config = await this.request<MagentoStoreConfig>(
      `/store/storeConfigs`,
      { method: "GET" },
      "magento_test_connection",
    );

    const storeData = Array.isArray(config) ? config[0] : config;
    if (!storeData) {
      throw new Error("magento_test_connection_no_stores");
    }

    return {
      provider: "magento",
      storeName: storeData.name ?? "Magento Store",
      storeUrl: storeData.base_url ?? this.#baseUrl,
      currency: storeData.base_currency_code ?? "USD",
    };
  }

  async searchCatalog(input: {
    merchantId: string;
    query?: string;
    limit?: number;
    cursor?: string;
  }): Promise<CommerceCatalogPage> {
    const pageSize = Math.max(1, Math.min(input.limit ?? 20, 100));
    const currentPage = parsePage(input.cursor);

    const params = new URLSearchParams({
      "searchCriteria[pageSize]": String(pageSize),
      "searchCriteria[currentPage]": String(currentPage),
    });

    if (input.query?.trim()) {
      params.set(
        "searchCriteria[filter_groups][0][filters][0][field]",
        "name",
      );
      params.set(
        "searchCriteria[filter_groups][0][filters][0][value]",
        `%${input.query.trim()}%`,
      );
      params.set(
        "searchCriteria[filter_groups][0][filters][0][condition_type]",
        "like",
      );
    }

    const response = await this.request<MagentoProductsResponse>(
      `/products?${params.toString()}`,
      { method: "GET" },
      "magento_search_catalog",
    );

    const products = await Promise.all(
      (response.items ?? []).map((p) => this.mapProduct(p)),
    );

    const totalPages = response.search_criteria?.total_count
      ? Math.ceil((response.search_criteria.total_count) / pageSize)
      : currentPage;

    return {
      products,
      nextCursor: currentPage < totalPages ? String(currentPage + 1) : null,
    };
  }

  async findCatalogProductBySku(input: {
    merchantId: string;
    sku: string;
  }): Promise<CommerceCatalogProduct | null> {
    const sku = input.sku.trim();
    if (!sku) return null;

    const params = new URLSearchParams({
      "searchCriteria[filter_groups][0][filters][0][field]": "sku",
      "searchCriteria[filter_groups][0][filters][0][value]": sku,
      "searchCriteria[filter_groups][0][filters][0][condition_type]": "eq",
      "searchCriteria[pageSize]": "1",
    });

    try {
      const response = await this.request<MagentoProductsResponse>(
        `/products?${params.toString()}`,
        { method: "GET" },
        "magento_catalog_lookup",
      );

      const product = (response.items ?? [])[0];
      return product ? this.mapProduct(product) : null;
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      if (errorMsg.includes("404")) {
        return null;
      }
      throw err;
    }
  }

  private async mapProduct(
    product: MagentoProduct,
  ): Promise<CommerceCatalogProduct> {
    const imageUrl = product.media_gallery_entries?.[0]?.file
      ? `${this.#baseUrl}/media/catalog/product${product.media_gallery_entries[0].file}`
      : undefined;

    const variants =
      product.extension_attributes?.configurable_product_links?.length ?? 0 > 0
        ? await this.request<MagentoProduct[]>(
            `/configurable-products/${product.id}/children`,
            { method: "GET" },
            "magento_configurable_children",
          )
        : [];

    return {
      id: String(product.id),
      title: product.name,
      description: stripHtml(product.description),
      productUrl: product.url_key
        ? `${this.#baseUrl}/catalog/product/view/id/${product.id}`
        : undefined,
      imageUrl,
      category: product.extension_attributes?.category_links?.[0]?.name,
      variants:
        variants.length > 0
          ? variants.map((variant) => ({
              id: String(variant.id),
              sku: variant.sku,
              title: variant.name ?? "Variant",
              unitPriceCents: moneyToCents(variant.price),
              currency: "USD",
              inventoryQuantity: variant.extension_attributes?.stock_item
                ?.qty ?? null,
              availableForSale:
                variant.extension_attributes?.stock_item?.is_in_stock ?? false,
              imageUrl: variant.media_gallery_entries?.[0]?.file
                ? `${this.#baseUrl}/media/catalog/product${variant.media_gallery_entries[0].file}`
                : imageUrl,
            }))
          : [
              {
                id: String(product.id),
                sku: product.sku,
                title: "Default",
                unitPriceCents: moneyToCents(product.price),
                currency: "USD",
                inventoryQuantity: product.extension_attributes?.stock_item
                  ?.qty ?? null,
                availableForSale:
                  product.extension_attributes?.stock_item?.is_in_stock ??
                  false,
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
    const url = `${this.#baseUrl}/rest/${this.#storeCode}/V1${path}`;
    const response = await this.#fetch(url, {
      ...init,
      headers: {
        Authorization: `Bearer ${this.#accessToken}`,
        "Content-Type": "application/json",
        ...init.headers,
      },
    });

    if (!response.ok) {
      const statusCode = response.status;
      if (statusCode === 401) {
        throw new Error("magento_invalid_credentials");
      }
      if (statusCode === 404) {
        throw new Error(`${errorCode}_not_found_${statusCode}`);
      }
      throw new Error(`${errorCode}_failed_${statusCode}`);
    }
    return response;
  }
}

function normalizeBaseUrl(value: string): string {
  const normalized = value.trim().replace(/\/+$/, "");
  if (!normalized) return "";
  try {
    const url = new URL(normalized);
    const isLocalDev =
      (url.hostname === "localhost" || url.hostname === "127.0.0.1") &&
      url.port === "8080";
    if (!isLocalDev && url.protocol !== "https:") {
      throw new Error("magento_https_required");
    }
    return url.origin + url.pathname.replace(/\/+$/, "");
  } catch (err) {
    if (err instanceof Error && err.message.includes("magento_https_required")) {
      throw err;
    }
    throw new Error("magento_invalid_base_url");
  }
}

function parsePage(cursor?: string): number {
  if (!cursor) return 1;
  const page = Number(cursor);
  if (!Number.isInteger(page) || page < 1) {
    throw new Error("magento_catalog_cursor_invalid");
  }
  return page;
}

function moneyToCents(value: string | number | undefined | null): number {
  return Math.round(Number(value || 0) * 100);
}

function stripHtml(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const text = value
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return text || undefined;
}

// Magento API response types
type MagentoStoreConfig = {
  id?: number;
  code?: string;
  website_id?: number;
  locale?: string;
  currency?: string;
  timezone?: string;
  name?: string;
  base_url?: string;
  base_link_url?: string;
  base_static_url?: string;
  base_media_url?: string;
  secure_base_url?: string;
  secure_base_link_url?: string;
  secure_base_static_url?: string;
  secure_base_media_url?: string;
  base_currency_code?: string;
};

type MagentoCartItem = {
  item_id: number;
  sku: string;
  name: string;
  product_id: number;
  quantity: number;
  price: number;
  product_type: string;
  quote_id: string;
};

type MagentoCartTotals = {
  grand_total: number;
  base_grand_total: number;
  subtotal: number;
  base_subtotal: number;
  discount_amount: number;
  base_discount_amount: number;
  subtotal_with_discount: number;
  base_subtotal_with_discount: number;
  shipping_amount: number;
  base_shipping_amount: number;
  shipping_discount_amount: number;
  base_shipping_discount_amount: number;
  tax_amount: number;
  base_tax_amount: number;
  weee_tax_applied_row: number;
  quote_currency_code?: string;
  items?: MagentoCartItem[];
  items_qty: number;
  quote_id?: string;
};

type MagentoPaymentResult = {
  order_id?: number | string;
};

type MagentoMediaGalleryEntry = {
  id: number;
  media_type: string;
  label?: string;
  position: number;
  disabled: boolean;
  types: string[];
  file?: string;
};

type MagentoStockItem = {
  qty?: number;
  min_qty?: number;
  max_sale_qty?: number;
  is_in_stock?: boolean;
  is_qty_decimal?: boolean;
  show_default_notification_message?: boolean;
  use_config_min_qty?: boolean;
  use_config_min_sale_qty?: boolean;
  use_config_max_sale_qty?: boolean;
  use_config_backorders?: boolean;
  use_config_notify_stock_qty?: boolean;
  use_config_qty_increments?: boolean;
  use_config_enable_qty_inc?: boolean;
  use_config_manage_stock?: boolean;
  use_config_qty_increments_use_default?: boolean;
};

type MagentoProduct = {
  id: number;
  sku: string;
  name: string;
  attribute_set_id: number;
  price: number;
  status: number;
  visibility: number;
  type_id: string;
  created_at: string;
  updated_at: string;
  description?: string;
  url_key?: string;
  media_gallery_entries?: MagentoMediaGalleryEntry[];
  extension_attributes?: {
    stock_item?: MagentoStockItem;
    configurable_product_links?: number[];
    category_links?: Array<{ position: number; category_id: string; name: string }>;
  };
};

type MagentoProductsResponse = {
  items?: MagentoProduct[];
  search_criteria?: {
    filter_groups?: Array<{ filters?: Array<{ field: string; value: string }> }>;
    sort_orders?: Array<{ field: string; direction: string }>;
    page_size?: number;
    current_page?: number;
    total_count?: number;
  };
};
