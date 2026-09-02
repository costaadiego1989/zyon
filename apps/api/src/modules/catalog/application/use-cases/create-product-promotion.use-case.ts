import { Injectable, Inject, ConflictException, Logger } from "@nestjs/common";
import { ProductPromotionEntity } from "../../domain/entities/product-promotion.entity.js";
import {
  PRODUCT_PROMOTION_REPOSITORY,
  type ProductPromotionRepositoryPort,
  type CreateProductPromotionInput,
  type ProductPromotionEntity as ProductPromotionSnapshot,
} from "../../domain/ports/product-promotion-repository.port.js";

@Injectable()
export class CreateProductPromotionUseCase {
  private readonly logger = new Logger(CreateProductPromotionUseCase.name);

  constructor(
    @Inject(PRODUCT_PROMOTION_REPOSITORY)
    private readonly repo: ProductPromotionRepositoryPort
  ) {}

  async execute(input: CreateProductPromotionInput): Promise<ProductPromotionSnapshot> {
    try {
      const entity = ProductPromotionEntity.create({
        merchantId: input.merchantId,
        productId: input.productId,
        variantId: input.variantId,
        categoryId: input.categoryId,
        couponId: input.couponId,
        discountType: input.discountType as "percent" | "fixed" | undefined,
        discountValue: input.discountValue,
        promoPriceInCents: input.promoPriceInCents,
        isActive: input.isActive ?? true,
        startsAt: input.startsAt,
        endsAt: input.endsAt,
      });

      return await this.repo.create({
        merchantId: entity.merchantId,
        productId: entity.productId,
        variantId: entity.variantId,
        categoryId: entity.categoryId,
        couponId: entity.couponId,
        discountType: entity.discountType,
        discountValue: entity.discountValue,
        promoPriceInCents: entity.promoPriceInCents,
        isActive: entity.isActive,
        startsAt: entity.startsAt,
        endsAt: entity.endsAt,
      });
    } catch (err) {
      if (err instanceof Error && err.message.startsWith("promotion_")) {
        throw new ConflictException(err.message);
      }
      throw err;
    }
  }
}
