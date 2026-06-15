import { Injectable } from "@nestjs/common";
import type { PrismaClient } from "@prisma/client";
import type {
  CommerceConnectionPort,
  MerchantCommerceConnection,
  MerchantCommerceCredentials,
  SaveMerchantCommerceCredentialsInput,
  UpdateCommerceConnectionHealthInput,
} from "../domain/ports/commerce-connection.port.js";
import {
  decryptCommerceSecret,
  encryptCommerceSecret,
} from "./commerce-secret-cipher.js";

@Injectable()
export class PrismaCommerceConnectionRepository
  implements CommerceConnectionPort
{
  constructor(private readonly prisma: PrismaClient) {}

  async getCredentials(
    merchantId: string,
  ): Promise<MerchantCommerceCredentials | undefined> {
    const row = await this.prisma.merchantCommerceConnection.findUnique({
      where: { merchantId: merchantId.trim() },
    });
    if (!row) return undefined;

    const secret = decodeSecret(
      row.provider,
      decryptCommerceSecret(row.adminTokenCipher),
    );
    if (row.provider === "woocommerce") {
      return {
        merchantId: row.merchantId,
        provider: "woocommerce",
        storeUrl: row.shopDomain,
        consumerKey: secret.consumerKey,
        consumerSecret: secret.consumerSecret,
      };
    }
    if (row.provider !== "shopify") {
      throw new Error("commerce_provider_invalid");
    }
    return {
      merchantId: row.merchantId,
      provider: "shopify",
      shopDomain: row.shopDomain,
      adminAccessToken: secret.adminAccessToken,
      storefrontAccessToken: secret.storefrontAccessToken,
      apiVersion: row.apiVersion ?? undefined,
    };
  }

  async getConnection(
    merchantId: string,
  ): Promise<MerchantCommerceConnection | undefined> {
    const row = await this.prisma.merchantCommerceConnection.findUnique({
      where: { merchantId: merchantId.trim() },
    });
    return row ? toConnection(row) : undefined;
  }

  async saveCredentials(
    input: SaveMerchantCommerceCredentialsInput,
  ): Promise<void> {
    const merchantId = input.merchantId.trim();
    const adminTokenCipher = encryptCommerceSecret(encodeSecret(input));
    const shopDomain =
      input.provider === "shopify"
        ? normalizeShopDomain(input.shopDomain)
        : normalizeStoreUrl(input.storeUrl);
    const apiVersion =
      input.provider === "shopify"
        ? input.apiVersion?.trim() || null
        : null;

    await this.prisma.merchantCommerceConnection.upsert({
      where: { merchantId },
      create: {
        merchantId,
        provider: input.provider,
        shopDomain,
        adminTokenCipher,
        apiVersion,
        status: "pending",
      },
      update: {
        provider: input.provider,
        shopDomain,
        adminTokenCipher,
        apiVersion,
        status: "pending",
        lastTestedAt: null,
        lastSyncedAt: null,
        lastErrorCode: null,
      },
    });
  }

  async updateHealth(
    input: UpdateCommerceConnectionHealthInput,
  ): Promise<void> {
    await this.prisma.merchantCommerceConnection.updateMany({
      where: { merchantId: input.merchantId.trim() },
      data: {
        status: input.status,
        ...(input.testedAt
          ? { lastTestedAt: new Date(input.testedAt) }
          : {}),
        ...(input.syncedAt
          ? { lastSyncedAt: new Date(input.syncedAt) }
          : {}),
        lastErrorCode: input.errorCode ?? null,
      },
    });
  }

  async disconnect(merchantId: string): Promise<void> {
    await this.prisma.merchantCommerceConnection.deleteMany({
      where: { merchantId: merchantId.trim() },
    });
  }
}

type SecretEnvelope =
  | {
      version: 1;
      provider: "shopify";
      adminAccessToken: string;
      storefrontAccessToken?: string;
    }
  | {
      version: 1;
      provider: "woocommerce";
      consumerKey: string;
      consumerSecret: string;
    };

function encodeSecret(input: SaveMerchantCommerceCredentialsInput): string {
  const envelope: SecretEnvelope =
    input.provider === "shopify"
      ? {
          version: 1,
          provider: "shopify",
          adminAccessToken: input.adminAccessToken.trim(),
          storefrontAccessToken:
            input.storefrontAccessToken?.trim() || undefined,
        }
      : {
          version: 1,
          provider: "woocommerce",
          consumerKey: input.consumerKey.trim(),
          consumerSecret: input.consumerSecret.trim(),
        };
  return JSON.stringify(envelope);
}

function decodeSecret(
  provider: string,
  decrypted: string,
): {
  adminAccessToken: string;
  storefrontAccessToken?: string;
  consumerKey: string;
  consumerSecret: string;
} {
  try {
    const parsed = JSON.parse(decrypted) as SecretEnvelope;
    if (parsed.version === 1 && parsed.provider === "shopify") {
      return {
        adminAccessToken: parsed.adminAccessToken,
        storefrontAccessToken: parsed.storefrontAccessToken,
        consumerKey: "",
        consumerSecret: "",
      };
    }
    if (parsed.version === 1 && parsed.provider === "woocommerce") {
      return {
        adminAccessToken: "",
        consumerKey: parsed.consumerKey,
        consumerSecret: parsed.consumerSecret,
      };
    }
  } catch {
    if (provider === "shopify") {
      return {
        adminAccessToken: decrypted,
        consumerKey: "",
        consumerSecret: "",
      };
    }
  }
  throw new Error("commerce_credentials_invalid");
}

function normalizeShopDomain(value: string): string {
  return value.trim().replace(/^https?:\/\//, "").replace(/\/+$/, "");
}

function normalizeStoreUrl(value: string): string {
  const url = new URL(value.trim());
  if (url.protocol !== "https:") {
    throw new Error("woocommerce_https_required");
  }
  return `${url.origin}${url.pathname.replace(/\/+$/, "")}`;
}

function toConnection(row: {
  merchantId: string;
  provider: string;
  shopDomain: string;
  status: string;
  apiVersion: string | null;
  lastTestedAt: Date | null;
  lastSyncedAt: Date | null;
  lastErrorCode: string | null;
  createdAt: Date;
  updatedAt: Date;
}): MerchantCommerceConnection {
  if (row.provider !== "shopify" && row.provider !== "woocommerce") {
    throw new Error("commerce_provider_invalid");
  }
  return {
    merchantId: row.merchantId,
    provider: row.provider,
    storeUrl:
      row.provider === "shopify"
        ? `https://${row.shopDomain}`
        : row.shopDomain,
    status:
      row.status === "healthy" || row.status === "degraded"
        ? row.status
        : "pending",
    apiVersion: row.apiVersion ?? undefined,
    lastTestedAt: row.lastTestedAt?.toISOString(),
    lastSyncedAt: row.lastSyncedAt?.toISOString(),
    lastErrorCode: row.lastErrorCode ?? undefined,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
