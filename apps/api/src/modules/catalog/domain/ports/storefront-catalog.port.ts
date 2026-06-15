import type { SuggestedProduct } from "@aacp/shared-types";

export const STOREFRONT_CATALOG_PORT = Symbol("STOREFRONT_CATALOG_PORT");

export interface StorefrontCatalogPort {
  search(
    merchantId: string,
    query: string,
    limit?: number,
  ): Promise<SuggestedProduct[]>;
  findBySku(
    merchantId: string,
    sku: string,
  ): Promise<SuggestedProduct | null>;
}
