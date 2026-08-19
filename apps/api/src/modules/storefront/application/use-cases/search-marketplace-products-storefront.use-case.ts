import { Injectable } from "@nestjs/common";
import { PrismaClient } from "@prisma/client";
import { SearchFederatedProductsUseCase } from "../../../marketplace/application/use-cases/search-federated-products.use-case.js";
import { PRISMA_CLIENT } from "../../../../shared/persistence/persistence.module.js";
import { Inject } from "@nestjs/common";

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
  constructor(
    private readonly searchFederated: SearchFederatedProductsUseCase,
    @Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient,
  ) {}

  async execute(input: SearchMarketplaceProductsInput): Promise<SearchMarketplaceProductsOutput> {
    const result = await this.searchFederated.execute({
      hostMerchantId: input.merchantId,
      query: input.query,
      category: input.category,
      limit: (input.limit ?? 10) * 2,
    });

    const merchantIds = [...new Set(result.products.map((p) => p.sourceMerchantId))];
    const merchants = await this.prisma.merchant.findMany({
      where: { id: { in: merchantIds } },
      select: { id: true, name: true },
    });
    const merchantMap = new Map(merchants.map((m) => [m.id, m.name]));

    const ranked = this.rankProducts(result.products, input.query, merchantMap);

    return {
      products: ranked.slice(0, input.limit ?? 10).map((p) => ({
        id: p.id,
        name: p.name,
        price: p.priceCents / 100,
        priceFormatted: (p.priceCents / 100).toLocaleString("pt-BR", {
          style: "currency",
          currency: "BRL",
        }),
        image: p.imageUrl ?? undefined,
        sellerName: merchantMap.get(p.sourceMerchantId) ?? "Loja parceira",
        sellerId: p.sourceMerchantId,
        inStock: p.stockAvailable,
      })),
    };
  }

  private rankProducts(
    products: any[],
    query: string,
    merchantMap: Map<string, string>,
  ): any[] {
    const normalized = query.toLowerCase().trim();

    const scored = products.map((p) => {
      const nameLower = p.name.toLowerCase();
      let score = 0;

      if (nameLower === normalized) {
        score = 100;
      } else if (nameLower.startsWith(normalized)) {
        score = 80;
      } else if (nameLower.includes(normalized)) {
        score = 60;
      } else if (p.description?.toLowerCase().includes(normalized)) {
        score = 40;
      }

      return { ...p, score };
    });

    const sorted = scored.sort((a, b) => {
      if (a.score !== b.score) return b.score - a.score;
      if (a.priceCents !== b.priceCents) return a.priceCents - b.priceCents;
      return 0;
    });

    const seen = new Set<string>();
    const diversified: any[] = [];

    for (const product of sorted) {
      const key = product.name;
      if (!seen.has(key)) {
        seen.add(key);
        diversified.push(product);
      } else {
        diversified.push(product);
      }
    }

    return diversified;
  }
}
