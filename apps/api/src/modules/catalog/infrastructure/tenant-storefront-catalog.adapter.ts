import { Inject, Injectable } from "@nestjs/common";
import type { SuggestedProduct } from "@zyon/shared-types";
import {
  COMMERCE_CATALOG_PORT,
  type CommerceCatalogReader,
} from "../../commerce/domain/ports/commerce-catalog.port.js";
import type { StorefrontCatalogPort } from "../domain/ports/storefront-catalog.port.js";
import { toSuggestedProducts } from "../domain/catalog.mappers.js";

@Injectable()
export class TenantStorefrontCatalogAdapter
  implements StorefrontCatalogPort
{
  constructor(
    @Inject(COMMERCE_CATALOG_PORT)
    private readonly catalog: CommerceCatalogReader,
  ) {}

  async search(
    merchantId: string,
    query: string,
    limit = 8,
  ): Promise<SuggestedProduct[]> {
    const page = await this.catalog.searchCatalog({
      merchantId,
      query,
      limit: Math.max(1, Math.min(limit, 50)),
    });
    return page.products.flatMap(toSuggestedProducts).slice(0, limit);
  }

  async findBySku(
    merchantId: string,
    sku: string,
  ): Promise<SuggestedProduct | null> {
    const product = await this.catalog.findCatalogProductBySku({
      merchantId,
      sku,
    });
    if (!product) return null;
    return (
      toSuggestedProducts(product).find(
        (variant) => variant.sku === sku,
      ) ?? null
    );
  }
}
