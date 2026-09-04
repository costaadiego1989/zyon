import { Injectable } from "@nestjs/common";
import type {
  FederatedProductRepository,
  FederatedProductSnapshot,
} from "../../domain/ports/federated-product-repository.port.js";
import type { MarketplaceConfigRepository } from "../../domain/ports/marketplace-config-repository.port.js";
import { FederatedSearchService } from "../../domain/services/federated-search.service.js";
import { PrismaClient } from "@prisma/client";

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
    private readonly prisma: PrismaClient,
  ) {}

  async execute(
    input: SearchFederatedProductsInput,
  ): Promise<SearchFederatedProductsOutput> {
    const config = await this.configRepository.get(input.hostMerchantId);
    if (config && !config.enabled) {
      return { products: [] };
    }

    const excludeMerchants = config?.blockedMerchants ?? [];

    const connections = await this.prisma.marketplaceConnection.findMany({
      where: { buyerMerchantId: input.hostMerchantId, status: "active" },
      select: { sellerMerchantId: true },
    });
    const includeMerchants = connections.map((c) => c.sellerMerchantId);

    if (includeMerchants.length === 0) {
      return { products: [] };
    }

    const results = await this.federatedSearchService.search({
      hostMerchantId: input.hostMerchantId,
      query: input.query,
      category: input.category,
      limit: input.limit ?? 20,
      excludeMerchants,
      includeMerchants,
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
