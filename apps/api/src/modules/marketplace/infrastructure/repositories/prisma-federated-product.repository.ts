import { Injectable } from "@nestjs/common";
import { Prisma, PrismaClient } from "@prisma/client";
import { contextualSearchGroups } from "../../../catalog/domain/services/contextual-product-search.js";
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
    scope?: { includeMerchants?: string[]; excludeMerchants: string[]; maxPriceCents?: number },
  ) {
    const groups = contextualSearchGroups(query);
    if (!groups.length || scope?.includeMerchants?.length === 0) return [];
    // The same accent-insensitive AND-of-synonyms rule as local discovery.
    // A whole-string `contains` made multiword requests silently miss partners.
    const searchable = Prisma.sql`lower(regexp_replace(normalize(
      f.name || ' ' || coalesce(f.description, '') || ' ' || f.searchable_text,
      NFD), '[\u0300-\u036f]', '', 'g'))`;
    const matching = Prisma.join(groups.map(group => Prisma.sql`(
      ${Prisma.join(group.map(term => Prisma.sql`strpos(${searchable}, ${term}) > 0`), " OR ")}
    )`), " AND ");
    const ids = await this.prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT f.id FROM federated_products f
      WHERE f.stock_available AND f.currency = 'BRL' AND ${matching}
      ${scope?.includeMerchants ? Prisma.sql`AND f.source_merchant_id = ANY(${scope.includeMerchants}::text[])` : Prisma.empty}
      ${scope?.excludeMerchants.length ? Prisma.sql`AND NOT (f.source_merchant_id = ANY(${scope.excludeMerchants}::text[]))` : Prisma.empty}
      ${scope?.maxPriceCents !== undefined ? Prisma.sql`AND f.price_cents <= ${scope.maxPriceCents}` : Prisma.empty}
      ${category ? Prisma.sql`AND f.category = ${category}` : Prisma.empty}
      ORDER BY f.id ASC LIMIT ${limit}
    `);
    if (!ids.length) return [];
    const products = await this.prisma.federatedProduct.findMany({
      where: {
        stockAvailable: true,
        currency: "BRL",
        id: { in: ids.map(item => item.id) },
        ...(scope?.maxPriceCents !== undefined ? { priceCents: { lte: scope.maxPriceCents } } : {}),
        sourceMerchantId: {
          ...(scope?.includeMerchants ? { in: scope.includeMerchants } : {}),
          ...(scope?.excludeMerchants.length ? { notIn: scope.excludeMerchants } : {}),
        },
        AND: [
          ...(category ? [{ category }] : []),
        ],
      },
      take: limit,
      orderBy: { id: "asc" },
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
        description: input.description ?? null,
        category: input.category ?? null,
        priceCents: input.priceCents ?? 0,
        currency: input.currency ?? "BRL",
        stockAvailable: input.stockAvailable ?? true,
        imageUrl: input.imageUrl ?? null,
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
    // Deletion is an idempotent projection operation. A duplicate or stale
    // invalidation must converge instead of failing the queue retry.
    await this.prisma.federatedProduct.deleteMany({
      where: { sourceMerchantId, sourceProductId },
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

