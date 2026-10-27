import type { MerchantRules } from "@zyon/shared-types";

export const CATALOG_MERCHANT_PORT = Symbol("CATALOG_MERCHANT_PORT");

/**
 * Abstraction over merchant profile reads needed by catalog.
 * Decouples catalog from the merchant module's concrete repository.
 * (CAT-H1/H4: Reduce module coupling)
 */
export interface CatalogMerchantPort {
  getProfile(merchantId: string): Promise<{ name?: string; theme?: unknown } | undefined>;
  getRules(merchantId: string): Promise<MerchantRules>;
}
