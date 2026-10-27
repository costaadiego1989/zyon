import type { Prisma, PrismaClient } from "@prisma/client";
import { z } from "zod";
import type {
  ProductPromotionRepositoryPort,
  CreateProductPromotionInput,
  UpdateProductPromotionInput,
  ProductPromotionEntity,
} from "../../domain/ports/product-promotion-repository.port.js";

const promotionLookupText = z.string().min(1).max(200).refine(value => value.trim().length > 0 && !value.includes("\0"));
const promotionLookupId = promotionLookupText.pipe(z.string().max(191));
const promotionVariantSchema = z.strictObject({
  id: promotionLookupId, sku: promotionLookupText, productId: promotionLookupId, isActive: z.literal(true),
  product: z.strictObject({ id: promotionLookupId, merchantId: promotionLookupId,
    categoryId: promotionLookupId.nullable(), isActive: z.literal(true), deletedAt: z.null() }),
});
const promotionVariantSelect = { id: true, sku: true, productId: true, isActive: true,
  product: { select: { id: true, merchantId: true, categoryId: true, isActive: true, deletedAt: true } } } as const;

export class PrismaProductPromotionRepository
  implements ProductPromotionRepositoryPort
{
  constructor(private readonly prisma: PrismaClient | Prisma.TransactionClient) {}

  async create(input: CreateProductPromotionInput): Promise<ProductPromotionEntity> {
    const row = await this.prisma.productPromotion.create({
      data: {
        merchantId: input.merchantId,
        productId: input.productId,
        variantId: input.variantId,
        categoryId: input.categoryId,
        couponId: input.couponId,
        discountType: input.discountType,
        discountValue: input.discountValue,
        promoPriceInCents: input.promoPriceInCents,
        isActive: input.isActive ?? true,
        startsAt: input.startsAt,
        endsAt: input.endsAt,
      },
    });
    return this.mapToDomain(row);
  }

  async update(
    id: string,
    merchantId: string,
    input: UpdateProductPromotionInput
  ): Promise<ProductPromotionEntity> {
    const row = await this.prisma.productPromotion.update({
      where: { id, merchantId },
      data: {
        productId: input.productId,
        variantId: input.variantId,
        categoryId: input.categoryId,
        couponId: input.couponId,
        discountType: input.discountType,
        discountValue: input.discountValue,
        promoPriceInCents: input.promoPriceInCents,
        isActive: input.isActive,
        startsAt: input.startsAt,
        endsAt: input.endsAt,
      },
    });
    return this.mapToDomain(row);
  }

  async getById(
    id: string,
    merchantId: string
  ): Promise<ProductPromotionEntity | null> {
    const row = await this.prisma.productPromotion.findUnique({
      where: { id, merchantId },
    });
    return row ? this.mapToDomain(row) : null;
  }

  async delete(id: string, merchantId: string): Promise<void> {
    await this.prisma.productPromotion.delete({
      where: { id, merchantId },
    });
  }

  async findByProduct(
    merchantId: string,
    productId: string
  ): Promise<ProductPromotionEntity[]> {
    const rows = await this.prisma.productPromotion.findMany({
      where: { merchantId, productId },
      orderBy: [{ isActive: "desc" }, { updatedAt: "desc" }],
    });
    return rows.map((r) => this.mapToDomain(r));
  }

  async findByVariant(
    merchantId: string,
    variantId: string
  ): Promise<ProductPromotionEntity[]> {
    const rows = await this.prisma.productPromotion.findMany({
      where: { merchantId, variantId },
    });
    return rows.map((r) => this.mapToDomain(r));
  }

  async findActiveByProduct(
    merchantId: string,
    productId: string,
    now: Date = new Date()
  ): Promise<ProductPromotionEntity[]> {
    const rows = await this.prisma.productPromotion.findMany({
      where: {
        merchantId,
        productId,
        isActive: true,
        startsAt: { lte: now },
        endsAt: { gt: now },
      },
    });
    return rows.map((r) => this.mapToDomain(r));
  }

  async findActiveBySku(
    merchantId: string,
    skuOrVariantId: string,
    now: Date = new Date()
  ): Promise<ProductPromotionEntity[]> {
    const input = z.strictObject({ merchantId: promotionLookupId, identifier: promotionLookupText, now: z.date() })
      .parse({ merchantId, identifier: skuOrVariantId, now });
    const observedAt = new Date(input.now.getTime());
    const active = { isActive: true, product: { merchantId: input.merchantId, isActive: true, deletedAt: null } };
    // IDs are authoritative and take precedence over a different product's SKU.
    // A SKU is unique only within a product, so never choose an arbitrary match.
    const exact = await this.prisma.productVariant.findFirst({
      where: { id: input.identifier, ...active }, select: promotionVariantSelect,
    });
    let variant: z.infer<typeof promotionVariantSchema>;
    if (exact !== null) {
      variant = promotionVariantSchema.parse(exact);
      if (variant.id !== input.identifier) throw new Error("product_promotion_catalog_scope_invalid");
    } else {
      const matches = z.array(promotionVariantSchema).max(2).parse(await this.prisma.productVariant.findMany({
        where: { sku: input.identifier, ...active }, select: promotionVariantSelect, take: 2, orderBy: { id: "asc" },
      }));
      if (matches.length !== 1) return [];
      variant = matches[0]!;
      if (variant.sku !== input.identifier) throw new Error("product_promotion_catalog_scope_invalid");
    }
    if (variant.product.merchantId !== input.merchantId || variant.productId !== variant.product.id) {
      throw new Error("product_promotion_catalog_scope_invalid");
    }

    const rows = await this.prisma.productPromotion.findMany({
      where: {
        merchantId: input.merchantId,
        isActive: true,
        startsAt: { lte: observedAt },
        endsAt: { gt: observedAt },
        OR: [
          { variantId: variant.id },
          { productId: variant.productId },
          ...(variant.product.categoryId === null ? [] : [{ categoryId: variant.product.categoryId }]),
        ],
      },
      orderBy: { id: "asc" },
    });
    return rows.map((r) => this.mapToDomain(r));
  }

  private mapToDomain(row: any): ProductPromotionEntity {
    return {
      id: row.id,
      merchantId: row.merchantId,
      productId: row.productId,
      variantId: row.variantId,
      categoryId: row.categoryId,
      couponId: row.couponId,
      discountType: row.discountType,
      discountValue: row.discountValue,
      promoPriceInCents: row.promoPriceInCents,
      isActive: row.isActive,
      startsAt: row.startsAt,
      endsAt: row.endsAt,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}
