import { Injectable, Logger } from "@nestjs/common";
import { PrismaClient, Prisma } from "@prisma/client";
import {
  ProductRepositoryPort,
  CreateProductInput,
  SearchProductsInput,
  SearchProductsResult,
} from "../../domain/ports/product-repository.port.js";
import { ProductEntity, ProductVariantProps } from "../../domain/entities/product.entity.js";

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
          categoryId: input.categoryId,
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
      isActive: true,
    };

    if (input.query) {
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
        variants: { include: { price: true, stock: true, media: { take: 1 } } },
      },
    };
    if (input.cursor) {
      findArgs.cursor = { id: input.cursor };
      findArgs.skip = 1;
    }

    const [products, total] = await Promise.all([
      this.prisma.product.findMany(findArgs),
      this.prisma.product.count({ where }),
    ]);

    const entities = products.map((p) => this.toEntity(p));
    const nextCursor = products.length === limit ? products[products.length - 1].id : undefined;

    return { products: entities, nextCursor, total };
  }

  async update(
    merchantId: string,
    productId: string,
    data: Partial<{ name: string; description: string; categoryId: string; isActive: boolean }>,
  ): Promise<ProductEntity> {
    const product = await this.prisma.product.update({
      where: { id: productId, merchantId },
      data,
      include: { variants: { include: { price: true, stock: true, media: true } } },
    });
    return this.toEntity(product);
  }

  async softDelete(merchantId: string, productId: string): Promise<void> {
    await this.prisma.product.update({
      where: { id: productId, merchantId },
      data: { isActive: false },
    });
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
      categoryId: raw.categoryId,
      isActive: raw.isActive,
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
