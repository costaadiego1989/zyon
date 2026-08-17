import { Inject, Injectable , Logger} from "@nestjs/common";
import type { SuggestedProduct } from "@zyon/shared-types";
import { STOREFRONT_CATALOG_PORT, type StorefrontCatalogPort } from "../domain/ports/storefront-catalog.port.js";
import { CorrelationIdStorage } from "../../../shared/logger/correlation-id.storage.js";

@Injectable()
export class SearchStorefrontProductsUseCase {
  private readonly logger = new Logger(SearchStorefrontProductsUseCase.name);

  constructor(@Inject(STOREFRONT_CATALOG_PORT) private readonly catalog: StorefrontCatalogPort) {}

  execute(
    merchantId: string,
    query: string,
    limit = 8,
  ): Promise<SuggestedProduct[]> {
    return this.catalog.search(merchantId, query, limit);
  }
}
