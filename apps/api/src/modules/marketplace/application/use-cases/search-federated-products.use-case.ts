import { Injectable } from "@nestjs/common";
import { FEDERATED_PRODUCT_REPOSITORY } from "../../domain/ports/federated-product-repository.port.js";
import type {
  FederatedProductRepository,
  FederatedProductSnapshot,
} from "../../domain/ports/federated-product-repository.port.js";
import { MARKETPLACE_CONFIG_REPOSITORY } from "../../domain/ports/marketplace-config-repository.port.js";
import type { MarketplaceConfigRepository } from "../../domain/ports/marketplace-config-repository.port.js";
import { FederatedSearchService } from "../../domain/services/federated-search.service.js";

export interface SearchFederatedProductsInput {
  hostMerchantId: string;
  query: string;
  category?: string;
  limit?: number;
}

export interface SearchFederatedProductsOutput {
  products: FederatedProductSnapshot[];
}

@Injectable()
export class SearchFederatedProductsUseCase {
  constructor(
    private readonly federatedProductRepository: FederatedProductRepository,
    private readonly configRepository: MarketplaceConfigRepository,
    private readonly federatedSearchService: FederatedSearchService,
  ) {}

  async execute(
    input: SearchFederatedProductsInput,
  ): Promise<SearchFederatedProductsOutput> {
    const config = await this.configRepository.get(input.hostMerchantId);
    // If config exists and is explicitly disabled, skip search
    if (config && !config.enabled) {
      return { products: [] };
    }

    const excludeMerchants = config?.blockedMerchants ?? [];

    const results = await this.federatedSearchService.search({
      hostMerchantId: input.hostMerchantId,
      query: input.query,
      category: input.category,
      limit: input.limit ?? 20,
      excludeMerchants,
    });

    const products = await Promise.all(
      results.map(async (r) => {
        const prod = await this.federatedProductRepository.getById(r.id);
        return prod;
      }),
    );

    return {
      products: products.filter((p) => p !== undefined),
    };
  }
}
