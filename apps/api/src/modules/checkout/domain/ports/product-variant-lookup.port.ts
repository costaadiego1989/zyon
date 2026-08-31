export const PRODUCT_VARIANT_LOOKUP_PORT = Symbol("PRODUCT_VARIANT_LOOKUP_PORT");

/**
 * Resolves product variant details by SKU for cross-sell and catalog queries.
 * Maintains merchant tenancy boundary in all lookups.
 */
export interface ProductVariantLookupPort {
  /**
   * Find product variant by SKU within merchant's catalog.
   * @param merchantId - Merchant boundary
   * @param sku - Product SKU
   * @returns Variant details or undefined if not found
   */
  findBySku(
    merchantId: string,
    sku: string
  ): Promise<{ name?: string; price?: number; imageUrl?: string } | undefined>;
}
