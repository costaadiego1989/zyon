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
import {
  ShopifyRateLimiter,
  parseRetryAfterSeconds,
  retryDelayFromHeaders,
  type ShopifyGraphqlEnvelope
} from "./shopify-rate-limiter.js";

export type ShopifyCommerceAdapterConfig = {
  shopDomain: string;
  adminAccessToken: string;
  storefrontAccessToken?: string;
  apiVersion?: string;
  /**
   * Feature flag. When true (default) the adapter uses the GraphQL Admin API
   * for everything that has a GraphQL equivalent (draft order create, price
   * rules/discount codes). When false the adapter falls back to the legacy
   * REST endpoints for shops on older API versions that don't yet expose the
   * GraphQL mutation. Catalog reads have always been GraphQL and are not
   * affected by this flag.
   */
  useGraphqlAdminApi?: boolean;
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

export class ShopifyCommerceAdapter
  implements
    CommerceCartPort,
    CommerceOrderPort,
    CommerceCatalogPort,
    CommerceConnectionTestPort
{
  readonly #domain: string;
  readonly #version: string;
  readonly #token: string;
  readonly #storefrontToken?: string;
  readonly #fetch: ShopifyFetchFn;
  readonly #useGraphql: boolean;
  readonly #rateLimiter: ShopifyRateLimiter;

  constructor(config: ShopifyCommerceAdapterConfig, fetchImpl?: ShopifyFetchFn) {
    this.#domain = normalizeShopDomain(config.shopDomain);
    this.#token = config.adminAccessToken.trim();
    this.#storefrontToken = config.storefrontAccessToken?.trim() || undefined;
    this.#version = config.apiVersion?.trim() || "2026-04";
    this.#fetch = fetchImpl ?? globalThis.fetch.bind(globalThis);
    // Default to GraphQL (REST Admin API sunset for public apps on Apr 1, 2025).
    // Merchants on older API versions can opt back into REST via this flag.
    this.#useGraphql = config.useGraphqlAdminApi !== false;
    this.#rateLimiter = new ShopifyRateLimiter();

    if (!this.#domain) throw new Error("shopify_commerce_shop_domain_required");
    if (!this.#token) throw new Error("shopify_commerce_admin_token_required");
    if (!validateShopifyApiVersion(this.#version)) {
      throw new Error("shopify_api_version_invalid");
    }
  }

  private adminUrl(resourcePath: string): string {
    const path = resourcePath.startsWith("/") ? resourcePath : `/${resourcePath}`;
    return `https://${this.#domain}/admin/api/${this.#version}${path}`;
  }

  private storefrontUrl(): string {
    return `https://${this.#domain}/api/${this.#version}/graphql.json`;
  }

  async validateCart(input: {
    merchantId: string;
    commerceCartRef: string;
  }): Promise<TrustedCartSnapshot> {
    if (!this.#storefrontToken) {
      throw new Error("shopify_storefront_access_token_required");
    }

    const data = await this.storefrontGraphql<ShopifyCartQueryData>(
      `query AacpCart($id: ID!) {
        cart(id: $id) {
          id
          cost {
            totalAmount { amount currencyCode }
          }
          lines(first: 250) {
            nodes {
              quantity
              merchandise {
                ... on ProductVariant {
                  sku
                  title
                  price { amount currencyCode }
                  product { title }
                }
              }
            }
          }
        }
      }`,
      { id: input.commerceCartRef.trim() },
      "shopify_validate_cart",
    );
    if (!data.cart) {
      throw new Error("shopify_cart_not_found");
    }
    const lines: TrustedCartLine[] = data.cart.lines.nodes.map((line) => ({
      sku: line.merchandise.sku ?? "",
      quantity: line.quantity,
      unitPriceCents: moneyToCents(line.merchandise.price.amount),
      title:
        line.merchandise.title === "Default Title"
          ? line.merchandise.product.title
          : `${line.merchandise.product.title} - ${line.merchandise.title}`,
    }));
    return {
      currency: data.cart.cost.totalAmount.currencyCode,
      totalCents: moneyToCents(data.cart.cost.totalAmount.amount),
      commerceCartRef: data.cart.id,
      lines,
    };
  }

  async testConnection(): Promise<CommerceConnectionHealth> {
    const data = await this.adminGraphql<ShopifyShopQueryData>(
      `query AacpShop {
        shop {
          name
          myshopifyDomain
          currencyCode
        }
      }`,
      {},
      "shopify_connection_test",
    );
    return {
      provider: "shopify",
      storeName: data.shop.name,
      storeUrl: `https://${data.shop.myshopifyDomain}`,
      currency: data.shop.currencyCode,
    };
  }

  async searchCatalog(input: {
    merchantId: string;
    query?: string;
    limit?: number;
    cursor?: string;
  }): Promise<CommerceCatalogPage> {
    const first = Math.max(1, Math.min(input.limit ?? 20, 100));
    const data = await this.adminGraphql<ShopifyProductsQueryData>(
      `query AacpProducts($first: Int!, $after: String, $query: String) {
        shop { currencyCode }
        products(first: $first, after: $after, query: $query) {
          pageInfo { hasNextPage endCursor }
          nodes {
            id
            title
            handle
            description
            productType
            status
            featuredMedia {
              preview {
                image { url altText }
              }
            }
            variants(first: 100) {
              nodes {
                id
                title
                sku
                price
                inventoryQuantity
                inventoryPolicy
                image { url altText }
              }
            }
          }
        }
      }`,
      {
        first,
        after: input.cursor || null,
        query: input.query?.trim() || null,
      },
      "shopify_catalog_search",
    );
    return {
      products: data.products.nodes
        .filter((product) => product.status === "ACTIVE")
        .map((product) =>
          mapShopifyProduct(product, data.shop.currencyCode, this.#domain),
        ),
      nextCursor: data.products.pageInfo.hasNextPage
        ? data.products.pageInfo.endCursor
        : null,
    };
  }

  async findCatalogProductBySku(input: {
    merchantId: string;
    sku: string;
  }): Promise<CommerceCatalogProduct | null> {
    const sku = input.sku.trim();
    if (!sku) return null;
    const data = await this.adminGraphql<ShopifyVariantQueryData>(
      `query AacpVariant($query: String!) {
        shop { currencyCode }
        productVariants(first: 1, query: $query) {
          nodes {
            id
            title
            sku
            price
            inventoryQuantity
            inventoryPolicy
            image { url altText }
            product {
              id
              title
              handle
              description
              productType
              status
              featuredMedia {
                preview {
                  image { url altText }
                }
              }
            }
          }
        }
      }`,
      { query: `sku:"${escapeShopifySearch(sku)}"` },
      "shopify_catalog_lookup",
    );
    const variant = data.productVariants.nodes[0];
    if (!variant || variant.product.status !== "ACTIVE") return null;
    return mapShopifyProduct(
      {
        ...variant.product,
        variants: { nodes: [variant] },
      },
      data.shop.currencyCode,
      this.#domain,
    );
  }

  private async adminGraphql<T>(
    query: string,
    variables: Record<string, unknown>,
    errorCode: string,
  ): Promise<T> {
    const response = await this.#fetch(this.adminUrl("/graphql.json"), {
      method: "POST",
      headers: adminHeaders(this.#token),
      body: JSON.stringify({ query, variables }),
    });
    if (response.status === 429) {
      const retryAfter = parseRetryAfterSeconds(response.headers.get("Retry-After"));
      throw new ShopifyRateLimitError(
        `${errorCode}_throttled_${response.status}`,
        retryAfter,
        this.#rateLimiter.available,
      );
    }
    if (!response.ok) {
      throw new Error(`${errorCode}_failed_${response.status}`);
    }
    const payload = (await response.json()) as ShopifyGraphqlEnvelope<T>;
    // Update the rate-limit snapshot from the response, regardless of success.
    this.#rateLimiter.updateFromResponse(payload.extensions?.cost);

    // THROTTLED can also appear inside `errors[]` on a 200 response.
    const throttled = payload.errors?.find(
      (e) => e.extensions?.code === "THROTTLED",
    );
    if (throttled) {
      throw new ShopifyRateLimitError(
        `${errorCode}_graphql_throttled`,
        undefined,
        this.#rateLimiter.available,
      );
    }
    if (payload.errors?.length || !payload.data) {
      const detail = payload.errors?.map((e) => e.message).join("; ");
      throw new Error(
        detail ? `${errorCode}_graphql_failed: ${detail}` : `${errorCode}_graphql_failed`,
      );
    }
    return payload.data;
  }

  private async storefrontGraphql<T>(
    query: string,
    variables: Record<string, unknown>,
    errorCode: string,
  ): Promise<T> {
    const response = await this.#fetch(this.storefrontUrl(), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Storefront-Access-Token": this.#storefrontToken ?? "",
      },
      body: JSON.stringify({ query, variables }),
    });
    if (!response.ok) {
      throw new Error(`${errorCode}_failed_${response.status}`);
    }
    const payload = (await response.json()) as ShopifyGraphqlEnvelope<T>;
    if (payload.errors?.length || !payload.data) {
      throw new Error(`${errorCode}_graphql_failed`);
    }
    return payload.data;
  }

  async createPendingOrder(input: {
    merchantId: string;
    sessionId: string;
    cart: TrustedCartSnapshot;
  }): Promise<{ commerceOrderId: string }> {
    if (this.#useGraphql) {
      return this.createPendingOrderGraphql(input);
    }
    return this.createPendingOrderRest(input);
  }

  /** GraphQL path: `draftOrderCreate` mutation (preferred). */
  private async createPendingOrderGraphql(input: {
    merchantId: string;
    sessionId: string;
    cart: TrustedCartSnapshot;
  }): Promise<{ commerceOrderId: string }> {
    // Shopify draftOrderCreate requires lineItems to reference existing
    // variants OR provide custom { title, originalUnitPrice, quantity }.
    // For carts built from a validated storefront snapshot we have SKUs but
    // not variant GIDs, so we use the custom lineItem path which Shopify
    // still supports for draft orders.
    const data = await this.adminGraphql<ShopifyDraftOrderCreateData>(
      `mutation AacpDraftOrderCreate($input: DraftOrderInput!) {
        draftOrderCreate(input: $input) {
          draftOrder {
            id
            legacyResourceId
          }
          userErrors { field message }
        }
      }`,
      {
        input: {
          currencyCode: input.cart.currency,
          // Use "AACP checkout session <id>" as the draft order note so the
          // merchant's Shopify admin shows the checkout session this order
          // originated from.
          // Note: draftOrderInput does not have a `note` field in 2026-04;
          // the GraphQL equivalent is `DraftOrderNoteAttributes` or the
          // legacy note via `taxExempt` etc. We stash it in customAttributes
          // so merchants can still trace orders back to AACP sessions.
          customAttributes: [
            { key: "_aacp_session_id", value: input.sessionId },
            { key: "_aacp_source", value: "aacp_checkout" }
          ],
          // To work with SKUs without variant GIDs we provide line items by
          // variantId=null and Shopify fills in via `variantLegacyResourceId`
          // or rejects — we use the safer custom path:
          lineItems: input.cart.lines.map((line) => ({
            title: line.title,
            quantity: line.quantity,
            originalUnitPrice: centsToMoneyString(line.unitPriceCents),
            sku: line.sku
          }))
        }
      },
      "shopify_draft_order_create"
    );
    assertNoShopifyUserErrors(
      data.draftOrderCreate.userErrors,
      "shopify_draft_order_create"
    );
    const draftOrder = data.draftOrderCreate.draftOrder;
    // Prefer legacyResourceId (numeric) for REST-style IDs that downstream
    // code (TenantCommerceAdapter) expects; fall back to GID if absent.
    const numericId = draftOrder?.legacyResourceId;
    const gid = draftOrder?.id;
    const id = numericId ?? gidToNumericSuffix(gid ?? "");
    if (!id) throw new Error("shopify_draft_order_id_missing");
    return { commerceOrderId: String(id) };
  }

  /** REST fallback for merchants on older API versions. Kept for backward compat. */
  private async createPendingOrderRest(input: {
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
    const draftOrderId = toShopifyGid(
      "DraftOrder",
      input.commerceOrderId,
    );
    if (await this.findCompletedOrderId(draftOrderId)) return;

    const data = await this.adminGraphql<ShopifyDraftOrderCompleteData>(
      `mutation AacpDraftOrderComplete($id: ID!, $sourceName: String) {
        draftOrderComplete(id: $id, sourceName: $sourceName) {
          draftOrder {
            id
            order { id }
          }
          userErrors { field message }
        }
      }`,
      {
        id: draftOrderId,
        sourceName: "aacp",
      },
      "shopify_mark_paid",
    );
    assertNoShopifyUserErrors(
      data.draftOrderComplete.userErrors,
      "shopify_mark_paid",
    );
    if (!data.draftOrderComplete.draftOrder?.order?.id) {
      throw new Error("shopify_completed_order_id_missing");
    }
  }

  async cancelOrder(input: {
    merchantId: string;
    commerceOrderId: string;
    reason: string;
    notifyCustomer?: boolean;
    restock?: boolean;
  }): Promise<void> {
    const orderId = input.commerceOrderId.startsWith("gid://shopify/Order/")
      ? input.commerceOrderId
      : await this.findCompletedOrderId(
          toShopifyGid("DraftOrder", input.commerceOrderId),
        );
    if (!orderId) throw new Error("shopify_completed_order_not_found");

    const data = await this.adminGraphql<ShopifyOrderCancelData>(
      `mutation AacpOrderCancel(
        $orderId: ID!
        $notifyCustomer: Boolean
        $refundMethod: OrderCancelRefundMethodInput!
        $restock: Boolean!
        $reason: OrderCancelReason!
        $staffNote: String
      ) {
        orderCancel(
          orderId: $orderId
          notifyCustomer: $notifyCustomer
          refundMethod: $refundMethod
          restock: $restock
          reason: $reason
          staffNote: $staffNote
        ) {
          job { id done }
          orderCancelUserErrors { field message code }
        }
      }`,
      {
        orderId,
        notifyCustomer: input.notifyCustomer ?? false,
        refundMethod: { originalPaymentMethodsRefund: false },
        restock: input.restock ?? true,
        reason: shopifyCancellationReason(input.reason),
        staffNote: input.reason.trim().slice(0, 255),
      },
      "shopify_cancel_order",
    );
    assertNoShopifyUserErrors(
      data.orderCancel.orderCancelUserErrors,
      "shopify_cancel_order",
    );
    if (!data.orderCancel.job?.id) {
      throw new Error("shopify_cancel_order_job_missing");
    }
  }

  private async findCompletedOrderId(
    draftOrderId: string,
  ): Promise<string | undefined> {
    const data = await this.adminGraphql<ShopifyDraftOrderLookupData>(
      `query AacpDraftOrder($id: ID!) {
        draftOrder(id: $id) {
          order { id }
        }
      }`,
      { id: draftOrderId },
      "shopify_draft_order_lookup",
    );
    return data.draftOrder?.order?.id;
  }
}

function centsToMoneyString(cents: number): string {
  return (cents / 100).toFixed(2);
}

/** Throws if `version` is not a Shopify API version in YYYY-MM format. */
function validateShopifyApiVersion(version: string): boolean {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(version);
}

/** Pulls the numeric suffix out of a Shopify GID (e.g. "gid://shopify/DraftOrder/123" → "123"). */
function gidToNumericSuffix(gid: string): string | undefined {
  const match = gid.match(/\/(\d+)$/);
  return match?.[1];
}

/** Error raised on a 429 or THROTTLED GraphQL response; carries retry hint. */
export class ShopifyRateLimitError extends Error {
  readonly retryAfterSeconds?: number;
  readonly availablePoints: number;

  constructor(message: string, retryAfterSeconds: number | undefined, availablePoints: number) {
    super(message);
    this.name = "ShopifyRateLimitError";
    this.retryAfterSeconds = retryAfterSeconds;
    this.availablePoints = availablePoints;
  }
}

function moneyToCents(value: string | number): number {
  return Math.round(Number(value) * 100);
}

function escapeShopifySearch(value: string): string {
  return value.replace(/([\\":()])/g, "\\$1");
}

function toShopifyGid(
  resource: "DraftOrder" | "Order",
  value: string,
): string {
  const normalized = value.trim();
  if (normalized.startsWith(`gid://shopify/${resource}/`)) return normalized;
  if (!/^\d+$/.test(normalized)) {
    throw new Error(`shopify_${resource.toLowerCase()}_id_invalid`);
  }
  return `gid://shopify/${resource}/${normalized}`;
}

function shopifyCancellationReason(reason: string): string {
  const normalized = reason.trim().toLowerCase();
  if (normalized.includes("fraud")) return "FRAUD";
  if (normalized.includes("inventory") || normalized.includes("estoque")) {
    return "INVENTORY";
  }
  if (
    normalized.includes("payment") ||
    normalized.includes("pagamento") ||
    normalized.includes("declin")
  ) {
    return "DECLINED";
  }
  if (
    normalized.includes("customer") ||
    normalized.includes("cliente") ||
    normalized.includes("comprador")
  ) {
    return "CUSTOMER";
  }
  return "OTHER";
}

function assertNoShopifyUserErrors(
  errors: Array<{ message: string }> | undefined,
  code: string,
): void {
  if (!errors?.length) return;
  throw new Error(`${code}_user_error:${errors[0]?.message ?? "unknown"}`);
}

function mapShopifyProduct(
  product: ShopifyProductNode,
  currency: string,
  domain: string,
): CommerceCatalogProduct {
  const imageUrl = product.featuredMedia?.preview?.image?.url;
  return {
    id: product.id,
    title: product.title,
    description: product.description || undefined,
    productUrl: `https://${domain}/products/${product.handle}`,
    imageUrl,
    category: product.productType || undefined,
    variants: product.variants.nodes
      .filter((variant) => Boolean(variant.sku))
      .map((variant) => ({
        id: variant.id,
        sku: variant.sku,
        title: variant.title,
        unitPriceCents: moneyToCents(variant.price),
        currency,
        inventoryQuantity: variant.inventoryQuantity,
        availableForSale:
          variant.inventoryPolicy === "CONTINUE" ||
          (variant.inventoryQuantity ?? 0) > 0,
        imageUrl: variant.image?.url ?? imageUrl,
      })),
  };
}

type ShopifyDraftOrderCreateData = {
  draftOrderCreate: {
    draftOrder?: {
      id: string;
      legacyResourceId?: string | null;
    } | null;
    userErrors: ShopifyUserError[];
  };
};

type ShopifyUserError = {
  field?: string[] | null;
  message: string;
  code?: string | null;
};

type ShopifyDraftOrderLookupData = {
  draftOrder: {
    order?: { id: string } | null;
  } | null;
};

type ShopifyDraftOrderCompleteData = {
  draftOrderComplete: {
    draftOrder?: {
      id: string;
      order?: { id: string } | null;
    } | null;
    userErrors: ShopifyUserError[];
  };
};

type ShopifyOrderCancelData = {
  orderCancel: {
    job?: { id: string; done: boolean } | null;
    orderCancelUserErrors: ShopifyUserError[];
  };
};

type ShopifyShopQueryData = {
  shop: {
    name: string;
    myshopifyDomain: string;
    currencyCode: string;
  };
};

type ShopifyCartQueryData = {
  cart: {
    id: string;
    cost: {
      totalAmount: { amount: string; currencyCode: string };
    };
    lines: {
      nodes: Array<{
        quantity: number;
        merchandise: {
          sku: string | null;
          title: string;
          price: { amount: string; currencyCode: string };
          product: { title: string };
        };
      }>;
    };
  } | null;
};

type ShopifyVariantNode = {
  id: string;
  title: string;
  sku: string;
  price: string;
  inventoryQuantity: number | null;
  inventoryPolicy: "DENY" | "CONTINUE";
  image?: { url: string; altText?: string | null } | null;
};

type ShopifyProductNode = {
  id: string;
  title: string;
  handle: string;
  description: string;
  productType: string;
  status: "ACTIVE" | "ARCHIVED" | "DRAFT";
  featuredMedia?: {
    preview?: { image?: { url: string; altText?: string | null } | null } | null;
  } | null;
  variants: { nodes: ShopifyVariantNode[] };
};

type ShopifyProductsQueryData = {
  shop: { currencyCode: string };
  products: {
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
    nodes: ShopifyProductNode[];
  };
};

type ShopifyVariantQueryData = {
  shop: { currencyCode: string };
  productVariants: {
    nodes: Array<
      ShopifyVariantNode & {
        product: Omit<ShopifyProductNode, "variants">;
      }
    >;
  };
};
