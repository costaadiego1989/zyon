import { Injectable } from "@nestjs/common";
import type {
  CommerceConnectionPort,
  MerchantCommerceConnection,
  MerchantCommerceCredentials,
  SaveMerchantCommerceCredentialsInput,
  UpdateCommerceConnectionHealthInput,
} from "../domain/ports/commerce-connection.port.js";

@Injectable()
export class InMemoryCommerceConnectionRepository
  implements CommerceConnectionPort
{
  private readonly credentials = new Map<
    string,
    MerchantCommerceCredentials
  >();
  private readonly connections = new Map<
    string,
    MerchantCommerceConnection
  >();

  async getCredentials(
    merchantId: string,
  ): Promise<MerchantCommerceCredentials | undefined> {
    return this.credentials.get(merchantId.trim());
  }

  async getConnection(
    merchantId: string,
  ): Promise<MerchantCommerceConnection | undefined> {
    return this.connections.get(merchantId.trim());
  }

  async saveCredentials(
    input: SaveMerchantCommerceCredentialsInput,
  ): Promise<void> {
    const merchantId = input.merchantId.trim();
    const now = new Date().toISOString();
    let credentials: MerchantCommerceCredentials;
    let storeUrl: string;
    if (input.provider === "shopify") {
      credentials = {
        merchantId,
        provider: "shopify",
        shopDomain: input.shopDomain.trim(),
        adminAccessToken: input.adminAccessToken.trim(),
        storefrontAccessToken:
          input.storefrontAccessToken?.trim() || undefined,
        apiVersion: input.apiVersion?.trim() || undefined,
      };
      storeUrl = `https://${input.shopDomain.trim().replace(/^https?:\/\//, "")}`;
    } else if (input.provider === "nuvemshop") {
      credentials = {
        merchantId,
        provider: "nuvemshop",
        storeId: input.storeId.trim(),
        accessToken: input.accessToken.trim(),
        userAgent: input.userAgent?.trim() || undefined,
      };
      storeUrl = `https://api.tiendanube.com/2025-03/${input.storeId.trim()}`;
    } else if (input.provider === "woocommerce") {
      credentials = {
        merchantId,
        provider: "woocommerce",
        storeUrl: input.storeUrl.trim(),
        consumerKey: input.consumerKey.trim(),
        consumerSecret: input.consumerSecret.trim(),
        webhookSecret: input.webhookSecret?.trim() || undefined,
      };
      storeUrl = input.storeUrl.trim();
    } else {
      // Tray or future providers — store minimal credential placeholder.
      credentials = undefined as unknown as MerchantCommerceCredentials;
      storeUrl = "";
    }
    this.credentials.set(merchantId, credentials);
    this.connections.set(merchantId, {
      merchantId,
      provider: input.provider as "shopify" | "woocommerce" | "nuvemshop",
      storeUrl,
      status: "pending",
      apiVersion:
        input.provider === "shopify"
          ? input.apiVersion?.trim() || undefined
          : undefined,
      createdAt: this.connections.get(merchantId)?.createdAt ?? now,
      updatedAt: now,
    });
  }

  async updateHealth(
    input: UpdateCommerceConnectionHealthInput,
  ): Promise<void> {
    const current = this.connections.get(input.merchantId);
    if (!current) return;
    this.connections.set(input.merchantId, {
      ...current,
      status: input.status,
      lastTestedAt: input.testedAt ?? current.lastTestedAt,
      lastSyncedAt: input.syncedAt ?? current.lastSyncedAt,
      lastErrorCode: input.errorCode,
      updatedAt: new Date().toISOString(),
    });
  }

  async disconnect(merchantId: string): Promise<void> {
    this.credentials.delete(merchantId.trim());
    this.connections.delete(merchantId.trim());
  }
}
