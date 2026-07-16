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
    if (row.provider === "nuvemshop") {
      return {
        merchantId: row.merchantId,
        provider: "nuvemshop",
        storeId: row.shopDomain,
        accessToken: secret.accessToken ?? "",
        userAgent: secret.userAgent,
      };
    }
    if (row.provider === "tray") {
      return {
        merchantId: row.merchantId,
        provider: "tray",
        apiAddress: row.shopDomain,
        accessToken: secret.accessToken ?? "",
        refreshToken: secret.refreshToken ?? "",
        accessTokenExpiresAt: secret.accessTokenExpiresAt ?? 0,
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
        : input.provider === "nuvemshop"
          ? input.storeId.trim()
          : input.provider === "tray"
            ? input.apiAddress.trim()
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
    }
  | {
      version: 1;
      provider: "nuvemshop";
      accessToken: string;
      userAgent?: string;
    }
  | {
      version: 1;
      provider: "tray";
      accessToken: string;
      refreshToken: string;
      accessTokenExpiresAt: number;
      consumerKey: string;
      consumerSecret: string;
    };

function encodeSecret(input: SaveMerchantCommerceCredentialsInput): string {
  let envelope: SecretEnvelope;
  if (input.provider === "shopify") {
    envelope = {
      version: 1,
      provider: "shopify",
      adminAccessToken: input.adminAccessToken.trim(),
      storefrontAccessToken: input.storefrontAccessToken?.trim() || undefined,
    };
  } else if (input.provider === "nuvemshop") {
    envelope = {
      version: 1,
      provider: "nuvemshop",
      accessToken: input.accessToken.trim(),
      userAgent: input.userAgent?.trim() || undefined,
    };
  } else if (input.provider === "tray") {
    envelope = {
      version: 1,
      provider: "tray",
      accessToken: input.accessToken.trim(),
      refreshToken: input.refreshToken.trim(),
      accessTokenExpiresAt: input.accessTokenExpiresAt,
      consumerKey: input.consumerKey.trim(),
      consumerSecret: input.consumerSecret.trim(),
    };
  } else {
    envelope = {
      version: 1,
      provider: "woocommerce",
      consumerKey: input.consumerKey.trim(),
      consumerSecret: input.consumerSecret.trim(),
    };
  }
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
  accessToken?: string;
  refreshToken?: string;
  accessTokenExpiresAt?: number;
  userAgent?: string;
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
    if (parsed.version === 1 && parsed.provider === "nuvemshop") {
      return {
        adminAccessToken: "",
        consumerKey: "",
        consumerSecret: "",
        accessToken: parsed.accessToken,
        userAgent: parsed.userAgent,
      };
    }
    if (parsed.version === 1 && parsed.provider === "tray") {
      return {
        adminAccessToken: "",
        consumerKey: parsed.consumerKey,
        consumerSecret: parsed.consumerSecret,
        accessToken: parsed.accessToken,
        refreshToken: parsed.refreshToken,
        accessTokenExpiresAt: parsed.accessTokenExpiresAt,
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
  // Dev-mode escape: allow http://localhost:8080 for local testing.
  const isLocalDev = process.env.NODE_ENV === "development" &&
    (url.hostname === "localhost" || url.hostname === "127.0.0.1") &&
    url.port === "8080";
  if (!isLocalDev && url.protocol !== "https:") {
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
  if (
    row.provider !== "shopify" &&
    row.provider !== "woocommerce" &&
    row.provider !== "nuvemshop" &&
    row.provider !== "tray"
  ) {
    throw new Error("commerce_provider_invalid");
  }
  return {
    merchantId: row.merchantId,
    provider: row.provider as "shopify" | "woocommerce" | "nuvemshop" | "tray",
    storeUrl:
      row.provider === "shopify"
        ? `https://${row.shopDomain}`
        : row.provider === "nuvemshop"
          ? `https://api.tiendanube.com/v1/${row.shopDomain}`
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
