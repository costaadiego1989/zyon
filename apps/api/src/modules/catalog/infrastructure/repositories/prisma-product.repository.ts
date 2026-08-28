import { Injectable, Logger } from "@nestjs/common";
import { PrismaClient, Prisma } from "@prisma/client";
import {
  ProductRepositoryPort,
  CreateProductInput,
  SearchProductsInput,
  SearchProductsResult,
} from "../../domain/ports/product-repository.port.js";
import { ProductEntity, ProductVariantProps } from "../../domain/entities/product.entity.js";

/**
 * Normalize text for accent- and case-insensitive matching.
 * "Café Especial" -> "cafe especial". Uses Unicode NFD decomposition to strip
 * diacritics so buyers can type "cafe" and match "Café" (Postgres `contains`
 * with mode:"insensitive" only ignores case, not accents).
 */
function normalizeForSearch(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
}

@Injectable()
export class PrismaProductRepository implements ProductRepositoryPort {
  private readonly logger = new Logger(PrismaProductRepository.name);

  constructor(private readonly prisma: PrismaClient) {}

  async create(input: CreateProductInput): Promise<ProductEntity> {
    const product = await this.prisma.$transaction(async (tx) => {
      const p = await tx.product.create({
        data: {
          merchantId: input.merchantId,
          name: input.name,
          description: input.description,
          type: input.type ?? "physical",
          metadata: input.metadata as Prisma.InputJsonValue ?? Prisma.JsonNull,
          categoryId: input.categoryId,
          seoTitle: input.seoTitle,
          metaDescription: input.metaDescription,
          slug: input.slug,
          ogTitle: input.ogTitle,
          ogDescription: input.ogDescription,
          twitterCard: input.twitterCard,
          keywords: input.keywords ?? [],
          variants: {
            create: input.variants.map((v) => ({
              sku: v.sku,
              attributes: v.attributes as Prisma.InputJsonValue,
              barcode: v.barcode,
              weightGrams: v.weightGrams,
              lengthCm: v.lengthCm,
              widthCm: v.widthCm,
              heightCm: v.heightCm,
              price: {
                create: {
                  basePriceInCents: v.basePriceInCents,
                  costInCents: v.costInCents,
                  taxPercent: v.taxPercent ?? 0,
                  currency: v.currency ?? "BRL",
                },
              },
              stock: {
                create: [{ quantity: v.stockQuantity ?? 0, reserved: 0 }],
              },
              media: v.media?.length
                ? {
                    create: v.media.map((m, i) => ({
                      url: m.url,
                      type: m.type,
                      alt: m.alt,
                      order: m.order ?? i,
                    })),
                  }
                : undefined,
            })),
          },
        },
        include: {
          variants: { include: { price: true, stock: true, media: true } },
        },
      });
      return p;
    });

    return this.toEntity(product);
  }

  async findById(merchantId: string, productId: string): Promise<ProductEntity | null> {
    const product = await this.prisma.product.findFirst({
      where: { id: productId, merchantId },
      include: {
        variants: { include: { price: true, stock: true, media: true } },
        reviews: { where: { approved: true }, select: { rating: true } },
      },
    });

    if (!product) return null;
    return this.toEntity(product);
  }

  async search(input: SearchProductsInput): Promise<SearchProductsResult> {
    const where: Prisma.ProductWhereInput = {
      merchantId: input.merchantId,
      deletedAt: null, // exclude soft-deleted products from all listings
    };

    // Only filter by isActive when explicitly requested (storefront uses true, dashboard shows all)
    if (input.isActiveOnly) {
      where.isActive = true;
    }

    // Skip filter for generic/browse queries — return all products
    const BROWSE_TERMS = ["produtos", "produto", "tudo", "catálogo", "catalogo", "ver tudo", "todos", "listar", "mostrar", "*", "all", "ver produtos"];
    const isGenericQuery = input.query && (input.query.trim() === "*" || BROWSE_TERMS.some(t => input.query!.toLowerCase().trim() === t));

    if (input.query && !isGenericQuery) {
      where.OR = [
        { name: { contains: input.query, mode: "insensitive" } },
        { description: { contains: input.query, mode: "insensitive" } },
      ];
    }

    if (input.categoryId) {
      where.categoryId = input.categoryId;
    }

    if (input.inStockOnly) {
      where.variants = { some: { stock: { some: { quantity: { gt: 0 } } } } };
    }

    const limit = input.limit ?? 20;
    const findArgs: Prisma.ProductFindManyArgs = {
      where,
      take: limit,
      orderBy: { createdAt: "desc" },
      include: {
        variants: { include: { price: true, stock: true, media: { orderBy: { order: "asc" } } } },
      },
    };
    if (input.offset != null) {
      findArgs.skip = input.offset;
    } else if (input.cursor) {
      findArgs.cursor = { id: input.cursor };
      findArgs.skip = 1;
    }

    const [products, total] = await Promise.all([
      this.prisma.product.findMany(findArgs),
      this.prisma.product.count({ where }),
    ]);

    let entities = products.map((p) => this.toEntity(p));

    // Accent-insensitive fallback: Postgres `contains` mode:"insensitive" only
    // ignores case, not diacritics. If the DB returned few results AND the query
    // is a text search, broaden to the full active catalog and match in-memory
    // using NFD-normalized comparison ("cafe" matches "Café").
    if (input.query && !isGenericQuery && entities.length < limit) {
      const normalizedQuery = normalizeForSearch(input.query);
      const alreadyFoundIds = new Set(entities.map((e) => e.id));

      // Only fetch broader set if the normalized query differs (has diacritics stripped)
      const queryHasAccentDifference = normalizedQuery !== input.query.toLowerCase().trim();
      if (queryHasAccentDifference || entities.length === 0) {
        const broadWhere: Prisma.ProductWhereInput = {
          merchantId: input.merchantId,
          deletedAt: null,
        };
        if (input.isActiveOnly) broadWhere.isActive = true;
        if (input.categoryId) broadWhere.categoryId = input.categoryId;
        if (input.inStockOnly) broadWhere.variants = { some: { stock: { some: { quantity: { gt: 0 } } } } };

        const candidates = await this.prisma.product.findMany({
          where: broadWhere,
          take: 100, // bounded scan
          include: {
            variants: { include: { price: true, stock: true, media: { orderBy: { order: "asc" } } } },
          },
        });

        const accentMatches = candidates
          .filter((p) => !alreadyFoundIds.has(p.id))
          .filter((p) => {
            const nameNorm = normalizeForSearch(p.name);
            const descNorm = normalizeForSearch(p.description ?? "");
            return nameNorm.includes(normalizedQuery) || descNorm.includes(normalizedQuery);
          })
          .slice(0, limit - entities.length)
          .map((p) => this.toEntity(p));

        if (accentMatches.length > 0) {
          entities = [...entities, ...accentMatches];
        }
      }
    }

    const nextCursor = products.length === limit ? products[products.length - 1].id : undefined;

    return { products: entities, nextCursor, total };
  }

  async update(
    merchantId: string,
    productId: string,
    data: Partial<{ name: string; description: string; type: string; metadata: Record<string, unknown>; categoryId: string; isActive: boolean; seoTitle: string; metaDescription: string; slug: string; ogTitle: string; ogDescription: string; twitterCard: string; keywords: string[] }>,
  ): Promise<ProductEntity> {
    const prismaData: Record<string, unknown> = {};
    if (data.name !== undefined) prismaData.name = data.name;
    if (data.description !== undefined) prismaData.description = data.description;
    if (data.type !== undefined) prismaData.type = data.type;
    if (data.metadata !== undefined) prismaData.metadata = data.metadata as Prisma.InputJsonValue;
    if (data.categoryId !== undefined) prismaData.categoryId = data.categoryId || null;
    if (data.isActive !== undefined) prismaData.isActive = data.isActive;
    if (data.seoTitle !== undefined) prismaData.seoTitle = data.seoTitle || null;
    if (data.metaDescription !== undefined) prismaData.metaDescription = data.metaDescription || null;
    if (data.slug !== undefined) prismaData.slug = data.slug || null;
    if (data.ogTitle !== undefined) prismaData.ogTitle = data.ogTitle || null;
    if (data.ogDescription !== undefined) prismaData.ogDescription = data.ogDescription || null;
    if (data.twitterCard !== undefined) prismaData.twitterCard = data.twitterCard || null;
    if (data.keywords !== undefined) prismaData.keywords = data.keywords;

    const product = await this.prisma.product.update({
      where: { id: productId, merchantId },
      data: prismaData,
      include: { variants: { include: { price: true, stock: true, media: true } } },
    });
    return this.toEntity(product);
  }

  async softDelete(merchantId: string, productId: string): Promise<void> {
    await this.prisma.product.update({
      where: { id: productId, merchantId },
      data: { isActive: false, deletedAt: new Date() },
    });
  }

  async listCategories(merchantId: string): Promise<Array<{ id: string; name: string; slug: string; productCount: number }>> {
    const categories = await this.prisma.productCategory.findMany({
      where: { merchantId },
      include: { _count: { select: { products: true } } },
      orderBy: { name: "asc" },
    });
    return categories.map((c) => ({
      id: c.id,
      name: c.name,
      slug: c.slug,
      productCount: c._count.products,
    }));
  }

  async addVariant(
    merchantId: string,
    productId: string,
    variant: CreateProductInput["variants"][0],
  ): Promise<ProductVariantProps> {
    // Verify product belongs to merchant
    const product = await this.prisma.product.findFirst({ where: { id: productId, merchantId } });
    if (!product) throw new Error("product_not_found");

    const created = await this.prisma.productVariant.create({
      data: {
        productId,
        sku: variant.sku,
        attributes: variant.attributes as Prisma.InputJsonValue,
        barcode: variant.barcode,
        weightGrams: variant.weightGrams,
        lengthCm: variant.lengthCm,
        widthCm: variant.widthCm,
        heightCm: variant.heightCm,
        price: {
          create: {
            basePriceInCents: variant.basePriceInCents,
            costInCents: variant.costInCents,
            taxPercent: variant.taxPercent ?? 0,
            currency: variant.currency ?? "BRL",
          },
        },
        stock: { create: [{ quantity: variant.stockQuantity ?? 0, reserved: 0 }] },
        media: variant.media?.length
          ? { create: variant.media.map((m, i) => ({ url: m.url, type: m.type, alt: m.alt, order: m.order ?? i })) }
          : undefined,
      },
      include: { price: true, stock: true, media: true },
    });

    return this.mapVariant(created);
  }

  private toEntity(raw: any): ProductEntity {
    const reviews = raw.reviews ?? [];
    const avgRating = reviews.length > 0 ? reviews.reduce((s: number, r: any) => s + r.rating, 0) / reviews.length : undefined;

    return new ProductEntity({
      id: raw.id,
      merchantId: raw.merchantId,
      name: raw.name,
      description: raw.description,
      type: raw.type ?? "physical",
      metadata: raw.metadata as Record<string, unknown> | undefined,
      categoryId: raw.categoryId,
      isActive: raw.isActive,
      seoTitle: raw.seoTitle,
      metaDescription: raw.metaDescription,
      slug: raw.slug,
      ogTitle: raw.ogTitle,
      ogDescription: raw.ogDescription,
      twitterCard: raw.twitterCard,
      keywords: raw.keywords ?? [],
      seoGeneratedAt: raw.seoGeneratedAt,
      createdAt: raw.createdAt,
      updatedAt: raw.updatedAt,
      variants: raw.variants?.map((v: any) => this.mapVariant(v)) ?? [],
      averageRating: avgRating,
      reviewCount: reviews.length,
    });
  }

  private mapVariant(v: any): ProductVariantProps {
    const stock = v.stock?.[0];
    return {
      id: v.id,
      sku: v.sku,
      attributes: v.attributes as Record<string, string>,
      barcode: v.barcode,
      weightGrams: v.weightGrams,
      lengthCm: v.lengthCm,
      widthCm: v.widthCm,
      heightCm: v.heightCm,
      isActive: v.isActive,
      basePriceInCents: v.price?.basePriceInCents ?? 0,
      costInCents: v.price?.costInCents,
      taxPercent: v.price?.taxPercent ?? 0,
      currency: v.price?.currency ?? "BRL",
      stockQuantity: stock?.quantity ?? 0,
      stockReserved: stock?.reserved ?? 0,
      media: v.media?.map((m: any) => ({ id: m.id, url: m.url, type: m.type, alt: m.alt, order: m.order })) ?? [],
    };
  }
}
