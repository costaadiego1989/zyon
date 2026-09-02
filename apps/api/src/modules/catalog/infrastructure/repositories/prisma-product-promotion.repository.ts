import type { PrismaClient } from "@prisma/client";
import type {
  ProductPromotionRepositoryPort,
  CreateProductPromotionInput,
  UpdateProductPromotionInput,
  ProductPromotionEntity,
} from "../../domain/ports/product-promotion-repository.port.js";

export class PrismaProductPromotionRepository
  implements ProductPromotionRepositoryPort
{
  constructor(private readonly prisma: PrismaClient) {}

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
    sku: string,
    now: Date = new Date()
  ): Promise<ProductPromotionEntity[]> {
    // Resolve SKU to variantId, then find promos by variantId or the variant's productId
    const variant = await this.prisma.productVariant.findFirst({
      where: { sku },
      select: { id: true, productId: true },
    });

    if (!variant) return [];

    const rows = await this.prisma.productPromotion.findMany({
      where: {
        merchantId,
        isActive: true,
        startsAt: { lte: now },
        endsAt: { gt: now },
        OR: [
          { variantId: variant.id }, // variant-level promo
          { productId: variant.productId }, // product-level promo
        ],
      },
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
