import { Injectable } from "@nestjs/common";
import type { PrismaClient } from "@prisma/client";
import type {
  CommerceConnectionPort,
  MerchantCommerceCredentials,
  SaveMerchantCommerceCredentialsInput
} from "../domain/ports/commerce-connection.port.js";
import { decryptCommerceSecret, encryptCommerceSecret } from "./commerce-secret-cipher.js";

@Injectable()
export class PrismaCommerceConnectionRepository implements CommerceConnectionPort {
  constructor(private readonly prisma: PrismaClient) {}

  async getCredentials(merchantId: string): Promise<MerchantCommerceCredentials | undefined> {
    const row = await this.prisma.merchantCommerceConnection.findUnique({
      where: { merchantId: merchantId.trim() }
    });
    if (!row) return undefined;
    return {
      merchantId: row.merchantId,
      provider: "shopify",
      shopDomain: row.shopDomain,
      adminAccessToken: decryptCommerceSecret(row.adminTokenCipher),
      apiVersion: row.apiVersion ?? undefined
    };
  }

  async saveCredentials(input: SaveMerchantCommerceCredentialsInput): Promise<void> {
    const merchantId = input.merchantId.trim();
    const adminTokenCipher = encryptCommerceSecret(input.adminAccessToken.trim());
    const shopDomain = input.shopDomain.trim();
    const apiVersion = input.apiVersion?.trim() || null;
    await this.prisma.merchantCommerceConnection.upsert({
      where: { merchantId },
      create: { merchantId, provider: "shopify", shopDomain, adminTokenCipher, apiVersion },
      update: { shopDomain, adminTokenCipher, apiVersion }
    });
  }
}
