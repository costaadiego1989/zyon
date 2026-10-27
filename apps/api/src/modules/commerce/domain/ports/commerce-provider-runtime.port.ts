import type {
  CommerceCatalogPage,
  CommerceConnectionHealth,
} from "@zyon/commerce-adapters";

export interface CommerceProviderRuntime {
  testConnection(merchantId: string): Promise<CommerceConnectionHealth>;
  searchCatalog(input: {
    merchantId: string;
    query?: string;
    limit?: number;
    cursor?: string;
  }): Promise<CommerceCatalogPage>;
}

export const COMMERCE_PROVIDER_RUNTIME = Symbol(
  "COMMERCE_PROVIDER_RUNTIME",
);
