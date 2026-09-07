export const STOREFRONT_CONFIG_QUERY_PORT = Symbol("STOREFRONT_CONFIG_QUERY_PORT");

export interface StorefrontConfigMerchant {
  id: string;
  name: string;
  theme: unknown;
  storeCategory: string | null;
  storeSettings: unknown;
}

export interface StorefrontConfigSnapshot {
  merchant: StorefrontConfigMerchant;
  subscriptionStatus?: string;
  agentRule?: { identity: unknown; checkoutSettings: unknown };
  quickReplies?: unknown;
  stories: unknown[];
}

export interface StorefrontConfigQueryPort {
  findPublicConfig(identifier: string): Promise<StorefrontConfigSnapshot | null>;
}
