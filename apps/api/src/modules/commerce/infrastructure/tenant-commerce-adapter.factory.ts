import { BadRequestException, Inject, Injectable } from "@nestjs/common";
import { ShopifyCommerceAdapter } from "@aacp/commerce-adapters";
import type {
  CommerceCartPort,
  CommerceOrderPort,
  TrustedCartSnapshot
} from "@aacp/commerce-adapters";
import { HttpClientService } from "../../../shared/http/http-client.service.js";
import { isProduction } from "../../../shared/config/secret-config.js";
import {
  COMMERCE_CONNECTION_PORT,
  type CommerceConnectionPort
} from "../domain/ports/commerce-connection.port.js";
import { retryWithBackoff } from "./commerce-retry.js";

function globalEnvCredentials(): { shopDomain: string; adminAccessToken: string; apiVersion?: string } | undefined {
  const shopDomain = process.env.SHOPIFY_SHOP_DOMAIN?.trim();
  const adminAccessToken = process.env.SHOPIFY_ADMIN_ACCESS_TOKEN?.trim();
  if (!shopDomain || !adminAccessToken) return undefined;
  return { shopDomain, adminAccessToken, apiVersion: process.env.SHOPIFY_API_VERSION?.trim() || undefined };
}

@Injectable()
export class TenantCommerceAdapterFactory implements CommerceCartPort, CommerceOrderPort {
  constructor(
    @Inject(COMMERCE_CONNECTION_PORT)
    private readonly connections: CommerceConnectionPort,
    private readonly http: HttpClientService
  ) {}

  private async resolve(merchantId: string): Promise<ShopifyCommerceAdapter> {
    const tenant = await this.connections.getCredentials(merchantId.trim());
    if (tenant) {
      return new ShopifyCommerceAdapter(
        {
          shopDomain: tenant.shopDomain,
          adminAccessToken: tenant.adminAccessToken,
          apiVersion: tenant.apiVersion
        },
        this.http.toFetch()
      );
    }

    if (isProduction()) {
      throw new BadRequestException("commerce_connection_not_configured_for_merchant");
    }

    const fallback = globalEnvCredentials();
    if (!fallback) {
      throw new BadRequestException("commerce_adapter_not_configured");
    }
    return new ShopifyCommerceAdapter(fallback, this.http.toFetch());
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
    return retryWithBackoff(() => adapter.createPendingOrder(input));
  }

  async markOrderPaid(input: {
    merchantId: string;
    commerceOrderId: string;
    paymentReference: string;
  }): Promise<void> {
    const adapter = await this.resolve(input.merchantId);
    await retryWithBackoff(() => adapter.markOrderPaid(input));
  }
}
