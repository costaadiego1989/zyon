import { Injectable } from "@nestjs/common";
import type {
  CommerceConnectionPort,
  MerchantCommerceCredentials,
  SaveMerchantCommerceCredentialsInput
} from "../domain/ports/commerce-connection.port.js";

@Injectable()
export class InMemoryCommerceConnectionRepository implements CommerceConnectionPort {
  private readonly rows = new Map<string, MerchantCommerceCredentials>();

  async getCredentials(merchantId: string): Promise<MerchantCommerceCredentials | undefined> {
    return this.rows.get(merchantId.trim());
  }

  async saveCredentials(input: SaveMerchantCommerceCredentialsInput): Promise<void> {
    const merchantId = input.merchantId.trim();
    this.rows.set(merchantId, {
      merchantId,
      provider: "shopify",
      shopDomain: input.shopDomain.trim(),
      adminAccessToken: input.adminAccessToken.trim(),
      apiVersion: input.apiVersion?.trim() || undefined
    });
  }
}
