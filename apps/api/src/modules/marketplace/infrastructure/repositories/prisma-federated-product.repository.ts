import { Injectable } from "@nestjs/common";
import { PrismaClient } from "@prisma/client";
import type {
  FederatedProductRepository,
  FederatedProductSearchParams,
  FederatedProductSnapshot,
  UpsertFederatedProductInput,
} from "../../domain/ports/federated-product-repository.port.js";
import type { FederatedSearchRepositoryPort } from "../../domain/services/federated-search.service.js";

@Injectable()
export class PrismaFederatedProductRepository
  implements FederatedProductRepository, FederatedSearchRepositoryPort
{
  constructor(private readonly prisma: PrismaClient) {}

  async search(
    params: FederatedProductSearchParams,
  ): Promise<FederatedProductSnapshot[]> {
    const products = await this.prisma.federatedProduct.findMany({
      where: {
        AND: [
          {
            OR: [
              { name: { contains: params.query, mode: "insensitive" } },
              { description: { contains: params.query, mode: "insensitive" } },
              { searchableText: { contains: params.query, mode: "insensitive" } },
            ],
          },
          ...(params.excludeMerchants && params.excludeMerchants.length > 0
            ? [
                {
                  sourceMerchantId: {
                    notIn: params.excludeMerchants,
                  },
                },
              ]
            : []),
        ],
      },
      take: params.limit,
    });
    return products.map((p: any) => this.toSnapshot(p));
  }

  async searchByQuery(
    query: string,
    category: string | undefined,
    limit: number,
  ) {
    const products = await this.prisma.federatedProduct.findMany({
      where: {
        AND: [
          {
            OR: [
              { name: { contains: query, mode: "insensitive" } },
              { description: { contains: query, mode: "insensitive" } },
              { searchableText: { contains: query, mode: "insensitive" } },
            ],
          },
          ...(category ? [{ category }] : []),
        ],
      },
      take: limit,
    });
    return products.map((p: any) => ({
      id: p.id,
      sourceMerchantId: p.sourceMerchantId,
      sourceProductId: p.sourceProductId,
      sellerName: "",
      name: p.name,
      description: p.description,
      category: p.category,
      priceCents: p.priceCents,
      currency: p.currency,
      commissionRateBps: 1500,
      stockAvailable: p.stockAvailable,
      imageUrl: p.imageUrl,
      tsRank: 1,
    }));
  }

  async upsert(
    input: UpsertFederatedProductInput,
  ): Promise<FederatedProductSnapshot> {
    const searchableText = this.buildSearchableText(
      input.name,
      input.description,
      input.category,
    );

    const product = await this.prisma.federatedProduct.upsert({
      where: {
        sourceMerchantId_sourceProductId: {
          sourceMerchantId: input.sourceMerchantId,
          sourceProductId: input.sourceProductId,
        },
      },
      update: {
        name: input.name,
        description: input.description ?? undefined,
        category: input.category ?? undefined,
        priceCents: input.priceCents ?? 0,
        currency: input.currency ?? "BRL",
        stockAvailable: input.stockAvailable ?? true,
        imageUrl: input.imageUrl ?? undefined,
        searchableText,
        syncedAt: new Date(),
      },
      create: {
        sourceMerchantId: input.sourceMerchantId,
        sourceProductId: input.sourceProductId,
        name: input.name,
        description: input.description ?? null,
        category: input.category ?? null,
        priceCents: input.priceCents ?? 0,
        currency: input.currency ?? "BRL",
        stockAvailable: input.stockAvailable ?? true,
        imageUrl: input.imageUrl ?? null,
        searchableText,
      },
    });
    return this.toSnapshot(product);
  }

  async delete(
    sourceMerchantId: string,
    sourceProductId: string,
  ): Promise<void> {
    await this.prisma.federatedProduct.delete({
      where: {
        sourceMerchantId_sourceProductId: {
          sourceMerchantId,
          sourceProductId,
        },
      },
    });
  }

  async getById(id: string): Promise<FederatedProductSnapshot | undefined> {
    const product = await this.prisma.federatedProduct.findUnique({
      where: { id },
    });
    if (!product) return undefined;
    return this.toSnapshot(product);
  }

  async listByMerchant(
    sourceMerchantId: string,
  ): Promise<FederatedProductSnapshot[]> {
    const products = await this.prisma.federatedProduct.findMany({
      where: { sourceMerchantId },
    });
    return products.map((p: any) => this.toSnapshot(p));
  }

  private buildSearchableText(
    name: string,
    description: string | undefined,
    category: string | undefined,
  ): string {
    return [name, description ?? "", category ?? ""].join(" ").trim();
  }

  private toSnapshot(product: any): FederatedProductSnapshot {
    return {
      id: product.id,
      sourceMerchantId: product.sourceMerchantId,
      sourceProductId: product.sourceProductId,
      name: product.name,
      description: product.description,
      category: product.category,
      priceCents: product.priceCents,
      currency: product.currency,
      stockAvailable: product.stockAvailable,
      imageUrl: product.imageUrl,
      searchableText: product.searchableText,
      createdAt: product.createdAt,
      syncedAt: product.syncedAt,
    };
  }
}

