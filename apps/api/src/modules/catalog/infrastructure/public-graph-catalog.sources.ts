import type { PrismaClient } from "@prisma/client";
import type { GraphCatalogSourcesPort, GraphPublicCatalogSource } from "../../graph-rag/domain/public-graph-sources.port.js";

const select = { id: true, merchantId: true, name: true, description: true, isActive: true, deletedAt: true, updatedAt: true,
  category: { select: { id: true, merchantId: true, name: true, updatedAt: true } },
  variants: { select: { id: true, sku: true, isActive: true, attributes: true, updatedAt: true } } } as const;
export class PublicGraphCatalogSources implements GraphCatalogSourcesPort {
  constructor(private readonly prisma: PrismaClient) {}
  private source(row: any): GraphPublicCatalogSource {
    const category = row.category?.merchantId === row.merchantId ? row.category : undefined;
    return { kind: "catalog", merchantId: row.merchantId, id: row.id,
      version: Math.max(row.updatedAt.getTime(), category?.updatedAt.getTime() ?? 0,
        ...row.variants.map((variant: any) => variant.updatedAt.getTime())),
      active: row.isActive && !row.deletedAt && row.variants.some((v: any) => v.isActive),
      name: row.name, description: row.description ?? "", ...(category ? { category: { id: category.id, name: category.name } } : {}),
      variants: row.variants.map((variant: any) => ({ id: variant.id, sku: variant.sku, active: variant.isActive,
        attributes: Object.fromEntries(Object.entries(variant.attributes ?? {}).filter((entry): entry is [string, string] => typeof entry[1] === "string")) })) };
  }
  async read(merchantId: string, productId: string) {
    const row = await this.prisma.product.findFirst({ where: { merchantId, id: productId }, select });
    return row ? this.source(row) : null;
  }
  async page(merchantId: string, cursor?: string) {
    // ID comparison keeps the cursor scoped even if its source was removed.
    const rows = await this.prisma.product.findMany({ where: { merchantId, ...(cursor ? { id: { gt: cursor } } : {}) },
      orderBy: { id: "asc" }, take: 51, select });
    const page = rows.slice(0, 50);
    return { sources: page.map(row => this.source(row)), ...(rows.length > 50 ? { nextCursor: page.at(-1)!.id } : {}) };
  }
}
