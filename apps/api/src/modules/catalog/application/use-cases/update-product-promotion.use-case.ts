import { Injectable, Inject, ConflictException, Logger } from "@nestjs/common";
import { ProductPromotionEntity } from "../../domain/entities/product-promotion.entity.js";
import {
  PRODUCT_PROMOTION_REPOSITORY,
  type ProductPromotionRepositoryPort,
  type UpdateProductPromotionInput,
  type ProductPromotionEntity as ProductPromotionSnapshot,
} from "../../domain/ports/product-promotion-repository.port.js";

@Injectable()
export class UpdateProductPromotionUseCase {
  private readonly logger = new Logger(UpdateProductPromotionUseCase.name);

  constructor(
    @Inject(PRODUCT_PROMOTION_REPOSITORY)
    private readonly repo: ProductPromotionRepositoryPort
  ) {}

  async execute(input: {
    id: string;
    merchantId: string;
    data: UpdateProductPromotionInput;
  }): Promise<ProductPromotionSnapshot> {
    try {
      const existing = await this.repo.getById(input.id, input.merchantId);
      if (!existing) {
        throw new Error("promotion_not_found");
      }

      // Validate domain invariants if updating discount or window
      if (
        input.data.startsAt ||
        input.data.endsAt ||
        input.data.discountType ||
        input.data.discountValue ||
        input.data.promoPriceInCents ||
        input.data.couponId
      ) {
        ProductPromotionEntity.create({
          id: existing.id,
          merchantId: existing.merchantId,
          productId: input.data.productId ?? existing.productId,
          variantId: input.data.variantId ?? existing.variantId,
          categoryId: input.data.categoryId ?? existing.categoryId,
          couponId: input.data.couponId ?? existing.couponId,
          discountType: (input.data.discountType ?? existing.discountType) as
            | "percent"
            | "fixed"
            | undefined,
          discountValue: input.data.discountValue ?? existing.discountValue,
          promoPriceInCents: input.data.promoPriceInCents ?? existing.promoPriceInCents,
          isActive: input.data.isActive ?? existing.isActive,
          startsAt: input.data.startsAt ?? existing.startsAt,
          endsAt: input.data.endsAt ?? existing.endsAt,
        });
      }

      return await this.repo.update(input.id, input.merchantId, input.data);
    } catch (err) {
      if (err instanceof Error && err.message.startsWith("promotion_")) {
        throw new ConflictException(err.message);
      }
      throw err;
    }
  }
}
