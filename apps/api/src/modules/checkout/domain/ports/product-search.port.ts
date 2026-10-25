import type { SuggestedProduct } from "@zyon/shared-types";

export const PRODUCT_SEARCH_PORT = Symbol("PRODUCT_SEARCH_PORT");

export interface ProductSearchPort {
  execute(merchantId: string, query: string, limit?: number): Promise<SuggestedProduct[]>;
}
