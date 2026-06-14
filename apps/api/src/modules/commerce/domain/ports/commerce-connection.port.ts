/** Per-tenant Shopify credentials, decrypted for use by the adapter factory. */
export interface MerchantCommerceCredentials {
  merchantId: string;
  provider: "shopify";
  shopDomain: string;
  adminAccessToken: string;
  apiVersion?: string;
}

export interface SaveMerchantCommerceCredentialsInput {
  merchantId: string;
  shopDomain: string;
  adminAccessToken: string;
  apiVersion?: string;
}

/** Stores and resolves Shopify credentials scoped by merchant_id (token at rest is ciphered). */
export interface CommerceConnectionPort {
  getCredentials(merchantId: string): Promise<MerchantCommerceCredentials | undefined>;
  saveCredentials(input: SaveMerchantCommerceCredentialsInput): Promise<void>;
}

export const COMMERCE_CONNECTION_PORT = Symbol("COMMERCE_CONNECTION_PORT");
