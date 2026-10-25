import { BadRequestException, Inject, Injectable, Logger } from "@nestjs/common";
import type { SuggestedProduct } from "@zyon/shared-types";
import { STOREFRONT_CATALOG_PORT, type StorefrontCatalogPort } from "../domain/ports/storefront-catalog.port.js";
import { CorrelationIdStorage } from "../../../shared/logger/correlation-id.storage.js";

const MAX_QUERY_LENGTH = 200;

@Injectable()
export class SearchStorefrontProductsUseCase {
  private readonly logger = new Logger(SearchStorefrontProductsUseCase.name);

  constructor(@Inject(STOREFRONT_CATALOG_PORT) private readonly catalog: StorefrontCatalogPort) {}

  execute(
    merchantId: string,
    query: string,
    limit = 8,
  ): Promise<SuggestedProduct[]> {
    const sanitized = this.sanitizeQuery(query);
    if (!sanitized) throw new BadRequestException("search_query_required");
    return this.catalog.search(merchantId, sanitized, Math.min(limit, 50));
  }

  private sanitizeQuery(raw: string): string {
    return raw
      .trim()
      .slice(0, MAX_QUERY_LENGTH)
      .replace(/[;'"\\`${}]/g, "");
  }
}
