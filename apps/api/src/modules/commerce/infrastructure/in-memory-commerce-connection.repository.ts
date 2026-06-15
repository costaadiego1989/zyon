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
    const credentials: MerchantCommerceCredentials =
      input.provider === "shopify"
        ? {
            merchantId,
            provider: "shopify",
            shopDomain: input.shopDomain.trim(),
            adminAccessToken: input.adminAccessToken.trim(),
            storefrontAccessToken:
              input.storefrontAccessToken?.trim() || undefined,
            apiVersion: input.apiVersion?.trim() || undefined,
          }
        : {
            merchantId,
            provider: "woocommerce",
            storeUrl: input.storeUrl.trim(),
            consumerKey: input.consumerKey.trim(),
            consumerSecret: input.consumerSecret.trim(),
          };
    this.credentials.set(merchantId, credentials);
    this.connections.set(merchantId, {
      merchantId,
      provider: input.provider,
      storeUrl:
        input.provider === "shopify"
          ? `https://${input.shopDomain.trim().replace(/^https?:\/\//, "")}`
          : input.storeUrl.trim(),
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
