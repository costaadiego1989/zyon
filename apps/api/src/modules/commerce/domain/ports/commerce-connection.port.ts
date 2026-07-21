export type CommerceProvider = "shopify" | "woocommerce" | "nuvemshop" | "tray";
export type CommerceConnectionStatus = "pending" | "healthy" | "degraded";

export interface ShopifyCommerceCredentials {
  merchantId: string;
  provider: "shopify";
  shopDomain: string;
  adminAccessToken: string;
  storefrontAccessToken?: string;
  apiVersion?: string;
}

export interface WooCommerceCredentials {
  merchantId: string;
  provider: "woocommerce";
  storeUrl: string;
  consumerKey: string;
  consumerSecret: string;
  webhookSecret?: string;
}

export interface NuvemshopCommerceCredentials {
  merchantId: string;
  provider: "nuvemshop";
  storeId: string;
  accessToken: string;
  userAgent?: string;
}

export interface TrayCommerceCredentials {
  merchantId: string;
  provider: "tray";
  apiAddress: string;
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresAt: number;
  consumerKey: string;
  consumerSecret: string;
}

export type MerchantCommerceCredentials =
  | ShopifyCommerceCredentials
  | WooCommerceCredentials
  | NuvemshopCommerceCredentials
  | TrayCommerceCredentials;

export interface SaveShopifyCommerceCredentialsInput {
  merchantId: string;
  provider: "shopify";
  shopDomain: string;
  adminAccessToken: string;
  storefrontAccessToken?: string;
  apiVersion?: string;
}

export interface SaveWooCommerceCredentialsInput {
  merchantId: string;
  provider: "woocommerce";
  storeUrl: string;
  consumerKey: string;
  consumerSecret: string;
  webhookSecret?: string;
}

export interface SaveNuvemshopCommerceCredentialsInput {
  merchantId: string;
  provider: "nuvemshop";
  storeId: string;
  accessToken: string;
  userAgent?: string;
}

export interface SaveTrayCommerceCredentialsInput {
  merchantId: string;
  provider: "tray";
  apiAddress: string;
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresAt: number;
  consumerKey: string;
  consumerSecret: string;
}

export type SaveMerchantCommerceCredentialsInput =
  | SaveShopifyCommerceCredentialsInput
  | SaveWooCommerceCredentialsInput
  | SaveNuvemshopCommerceCredentialsInput
  | SaveTrayCommerceCredentialsInput;

export interface MerchantCommerceConnection {
  merchantId: string;
  provider: CommerceProvider;
  storeUrl: string;
  status: CommerceConnectionStatus;
  apiVersion?: string;
  lastTestedAt?: string;
  lastSyncedAt?: string;
  lastErrorCode?: string;
  createdAt: string;
  updatedAt: string;
}

export interface UpdateCommerceConnectionHealthInput {
  merchantId: string;
  status: CommerceConnectionStatus;
  testedAt?: string;
  syncedAt?: string;
  errorCode?: string;
}

export interface CommerceConnectionPort {
  getCredentials(
    merchantId: string,
  ): Promise<MerchantCommerceCredentials | undefined>;
  getConnection(
    merchantId: string,
  ): Promise<MerchantCommerceConnection | undefined>;
  saveCredentials(input: SaveMerchantCommerceCredentialsInput): Promise<void>;
  updateHealth(input: UpdateCommerceConnectionHealthInput): Promise<void>;
  disconnect(merchantId: string): Promise<void>;
}

export const COMMERCE_CONNECTION_PORT = Symbol("COMMERCE_CONNECTION_PORT");
