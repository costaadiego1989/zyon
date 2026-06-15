import { Inject, Injectable } from "@nestjs/common";
import type { SuggestedProduct } from "@aacp/shared-types";
import { STOREFRONT_CATALOG_PORT, type StorefrontCatalogPort } from "../domain/ports/storefront-catalog.port.js";

@Injectable()
export class SearchStorefrontProductsUseCase {
  constructor(@Inject(STOREFRONT_CATALOG_PORT) private readonly catalog: StorefrontCatalogPort) {}

  execute(
    merchantId: string,
    query: string,
    limit = 8,
  ): Promise<SuggestedProduct[]> {
    return this.catalog.search(merchantId, query, limit);
  }
}
