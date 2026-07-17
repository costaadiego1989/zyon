import { BadRequestException, Inject, Injectable } from "@nestjs/common";
import {
  ShopifyCommerceAdapter,
  WooCommerceCommerceAdapter,
  NuvemshopCommerceAdapter,
  TrayCommerceAdapter,
} from "@zyon/commerce-adapters";
import type {
  CommerceCatalogPage,
  CommerceCatalogPort,
  CommerceCatalogProduct,
  CommerceCartPort,
  CommerceConnectionHealth,
  CommerceOrderPort,
  CommerceProviderPort,
  TrustedCartSnapshot
} from "@zyon/commerce-adapters";
import { HttpClientService } from "../../../shared/http/http-client.service.js";
import { isProduction } from "../../../shared/config/secret-config.js";
import {
  COMMERCE_CONNECTION_PORT,
  type CommerceConnectionPort
} from "../domain/ports/commerce-connection.port.js";
import { retryWithBackoff } from "./commerce-retry.js";

/**
 * P2 fix: the global-env Shopify fallback is limited to a single opt-in demo
 * merchant (SHOPIFY_DEMO_MERCHANT_ID) and is disabled in production.
 * Any merchant that doesn't have persisted credentials and isn't the known
 * demo merchant gets a hard "not configured" error regardless of environment.
 */
function globalEnvCredentials(merchantId: string):
  | {
      shopDomain: string;
      adminAccessToken: string;
      storefrontAccessToken?: string;
      apiVersion?: string;
    }
  | undefined {
  // Fail-closed: no fallback in production under any circumstance.
  if (isProduction()) return undefined;

  const demoMerchantId = process.env.SHOPIFY_DEMO_MERCHANT_ID?.trim();
  // If no explicit demo-merchant opt-in is configured, the fallback is disabled.
  if (!demoMerchantId) return undefined;
  // Only the single known demo merchant may use the global fallback.
  if (merchantId.trim() !== demoMerchantId) return undefined;

  const shopDomain = process.env.SHOPIFY_SHOP_DOMAIN?.trim();
  const adminAccessToken = process.env.SHOPIFY_ADMIN_ACCESS_TOKEN?.trim();
  if (!shopDomain || !adminAccessToken) return undefined;
  return {
    shopDomain,
    adminAccessToken,
    storefrontAccessToken:
      process.env.SHOPIFY_STOREFRONT_ACCESS_TOKEN?.trim() || undefined,
    apiVersion: process.env.SHOPIFY_API_VERSION?.trim() || undefined,
  };
}

/** Simple TTL cache entry for resolved adapters. */
interface CachedAdapter {
  adapter: CommerceProviderPort;
  expiresAt: number;
}

const ADAPTER_CACHE_TTL_MS = 30_000; // 30 seconds
const ADAPTER_CACHE_MAX_SIZE = 100;

@Injectable()
export class TenantCommerceAdapterFactory
  implements CommerceCartPort, CommerceOrderPort, CommerceCatalogPort
{
  private readonly adapterCache = new Map<string, CachedAdapter>();

  constructor(
    @Inject(COMMERCE_CONNECTION_PORT)
    private readonly connections: CommerceConnectionPort,
    private readonly http: HttpClientService
  ) {}

  /** Invalidate the adapter cache for a merchant (e.g., on credential update). */
  invalidateAdapter(merchantId: string): void {
    this.adapterCache.delete(merchantId.trim());
  }

  private async resolve(merchantId: string): Promise<CommerceProviderPort> {
    const key = merchantId.trim();
    const now = Date.now();
    const cached = this.adapterCache.get(key);
    if (cached && cached.expiresAt > now) {
      return cached.adapter;
    }
    const adapter = await this.resolveFromSource(key);
    // Evict oldest entries when cache is full.
    if (this.adapterCache.size >= ADAPTER_CACHE_MAX_SIZE) {
      const oldest = this.adapterCache.keys().next().value;
      if (oldest) this.adapterCache.delete(oldest);
    }
    this.adapterCache.set(key, { adapter, expiresAt: now + ADAPTER_CACHE_TTL_MS });
    return adapter;
  }

  private async resolveFromSource(merchantId: string): Promise<CommerceProviderPort> {
    const tenant = await this.connections.getCredentials(merchantId.trim());
    if (tenant?.provider === "shopify") {
      return new ShopifyCommerceAdapter(
        {
          shopDomain: tenant.shopDomain,
          adminAccessToken: tenant.adminAccessToken,
          storefrontAccessToken: tenant.storefrontAccessToken,
          apiVersion: tenant.apiVersion,
          // REST is the safe default for tenant credentials. GraphQL can be
          // opted into per-merchant once the storefront is confirmed on a
          // 2024-10+ API version.
          useGraphqlAdminApi: false,
        },
        this.http.toFetch()
      );
    }
    if (tenant?.provider === "woocommerce") {
      return new WooCommerceCommerceAdapter(
        {
          storeUrl: tenant.storeUrl,
          consumerKey: tenant.consumerKey,
          consumerSecret: tenant.consumerSecret,
        },
        globalThis.fetch.bind(globalThis),
      );
    }
    if (tenant?.provider === "nuvemshop") {
      return new NuvemshopCommerceAdapter(
        {
          storeId: tenant.storeId,
          accessToken: tenant.accessToken,
          userAgent: tenant.userAgent,
        },
        this.http.toFetch(),
      );
    }
    if (tenant?.provider === "tray") {
      return new TrayCommerceAdapter(
        {
          merchantId: tenant.merchantId,
          provider: "tray",
          apiAddress: tenant.apiAddress,
          accessToken: tenant.accessToken,
          refreshToken: tenant.refreshToken,
          accessTokenExpiresAt: tenant.accessTokenExpiresAt,
          consumerKey: tenant.consumerKey,
          consumerSecret: tenant.consumerSecret,
        },
        this.http.toFetch(),
      );
    }

    if (isProduction()) {
      throw new BadRequestException("commerce_connection_not_configured_for_merchant");
    }

    // P2 fix: fallback is scoped to the explicit demo merchant only.
    const fallback = globalEnvCredentials(merchantId);
    if (!fallback) {
      throw new BadRequestException("commerce_adapter_not_configured");
    }
    return new ShopifyCommerceAdapter(
      { ...fallback, useGraphqlAdminApi: false },
      this.http.toFetch(),
    );
  }

  async validateCart(input: { merchantId: string; commerceCartRef: string }): Promise<TrustedCartSnapshot> {
    const adapter = await this.resolve(input.merchantId);
    return retryWithBackoff(() => adapter.validateCart(input));
  }

  async createPendingOrder(input: {
    merchantId: string;
    sessionId: string;
    cart: TrustedCartSnapshot;
  }): Promise<{ commerceOrderId: string }> {
    const adapter = await this.resolve(input.merchantId);
    // P2 fix: createPendingOrder is a non-idempotent POST with no idempotency
    // key accepted by the provider contract. Retrying on network/5xx would
    // create duplicate pending orders. We do NOT retry this call; the caller's
    // index (PendingCommerceOrderIndex) provides idempotency at the use-case
    // level across invocations.
    return adapter.createPendingOrder(input);
  }

  async markOrderPaid(input: {
    merchantId: string;
    commerceOrderId: string;
    paymentReference: string;
  }): Promise<void> {
    const adapter = await this.resolve(input.merchantId);
    // P1 fix: markOrderPaid is also a non-idempotent mutation. The dedup guard
    // in MarkCommerceOrderPaidUseCase (tryReserve) prevents concurrent double
    // invocations. We do NOT retry here; a transient failure should bubble up
    // so the webhook platform retries the full use-case (which the dedup guard
    // will then short-circuit correctly).
    await adapter.markOrderPaid(input);
  }

  async cancelOrder(input: {
    merchantId: string;
    commerceOrderId: string;
    reason: string;
    notifyCustomer?: boolean;
    restock?: boolean;
  }): Promise<void> {
    const adapter = await this.resolve(input.merchantId);
    if (!adapter.cancelOrder) {
      throw new BadRequestException("commerce_order_cancellation_not_supported");
    }
    await retryWithBackoff(() => adapter.cancelOrder!(input));
  }

  async testConnection(merchantId: string): Promise<CommerceConnectionHealth> {
    const adapter = await this.resolve(merchantId);
    return retryWithBackoff(() => adapter.testConnection());
  }

  async searchCatalog(input: {
    merchantId: string;
    query?: string;
    limit?: number;
    cursor?: string;
  }): Promise<CommerceCatalogPage> {
    const adapter = await this.resolve(input.merchantId);
    return retryWithBackoff(() => adapter.searchCatalog(input));
  }

  async findCatalogProductBySku(input: {
    merchantId: string;
    sku: string;
  }): Promise<CommerceCatalogProduct | null> {
    const adapter = await this.resolve(input.merchantId);
    return retryWithBackoff(() => adapter.findCatalogProductBySku(input));
  }
}
