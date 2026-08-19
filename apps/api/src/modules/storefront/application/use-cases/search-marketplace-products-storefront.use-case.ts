import { Injectable } from "@nestjs/common";
import { SearchFederatedProductsUseCase } from "../../../marketplace/application/use-cases/search-federated-products.use-case.js";

export interface SearchMarketplaceProductsInput {
  merchantId: string;
  query: string;
  category?: string;
  limit?: number;
}

export interface FederatedProductResponse {
  id: string;
  name: string;
  price: number;
  priceFormatted: string;
  image?: string;
  sellerName: string;
  sellerId: string;
  inStock: boolean;
}

export interface SearchMarketplaceProductsOutput {
  products: FederatedProductResponse[];
}

@Injectable()
export class SearchMarketplaceProductsStorefrontUseCase {
  constructor(private readonly searchFederated: SearchFederatedProductsUseCase) {}

  async execute(input: SearchMarketplaceProductsInput): Promise<SearchMarketplaceProductsOutput> {
    const result = await this.searchFederated.execute({
      hostMerchantId: input.merchantId,
      query: input.query,
      category: input.category,
      limit: input.limit ?? 10,
    });

    return {
      products: result.products.map((p) => ({
        id: p.id,
        name: p.name,
        price: p.priceCents / 100,
        priceFormatted: (p.priceCents / 100).toLocaleString("pt-BR", {
          style: "currency",
          currency: "BRL",
        }),
        image: p.imageUrl ?? undefined,
        sellerName: "Loja parceira",
        sellerId: p.sourceMerchantId,
        inStock: p.stockAvailable,
      })),
    };
  }
}
