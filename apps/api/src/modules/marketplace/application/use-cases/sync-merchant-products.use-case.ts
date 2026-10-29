import { Injectable } from "@nestjs/common";
import { FEDERATED_PRODUCT_REPOSITORY } from "../../domain/ports/federated-product-repository.port.js";
import type { FederatedProductRepository } from "../../domain/ports/federated-product-repository.port.js";

export interface SyncMerchantProductsInput {
  sourceMerchantId: string;
  products: Array<{
    sourceProductId: string;
    name: string;
    description?: string;
    category?: string;
    priceCents: number;
    currency?: string;
    stockAvailable?: boolean;
    imageUrl?: string;
  }>;
}

export interface SyncMerchantProductsOutput {
  synced: number;
}

@Injectable()
export class SyncMerchantProductsUseCase {
  constructor(
    private readonly productRepository: FederatedProductRepository,
  ) {}

  async execute(
    input: SyncMerchantProductsInput,
  ): Promise<SyncMerchantProductsOutput> {
    let synced = 0;

    for (const product of input.products) {
      await this.productRepository.upsert({
        sourceMerchantId: input.sourceMerchantId,
        sourceProductId: product.sourceProductId,
        name: product.name,
        description: product.description,
        category: product.category,
        priceCents: product.priceCents,
        currency: product.currency,
        stockAvailable: product.stockAvailable,
        imageUrl: product.imageUrl,
      });
      synced++;
    }

    return { synced };
  }
}
