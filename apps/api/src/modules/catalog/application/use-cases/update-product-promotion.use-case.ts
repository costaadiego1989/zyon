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

      const data: UpdateProductPromotionInput = Object.fromEntries(Object.entries(input.data).filter(([, value]) => value !== undefined));
      const price = data.promoPriceInCents != null, inline = data.discountType != null || data.discountValue != null, coupon = data.couponId != null;
      if (Number(price) + Number(inline) + Number(coupon) > 1) throw new Error("promotion_descriptor_ambiguous");
      if (price) Object.assign(data, { discountType: null, discountValue: null, couponId: null });
      else if (coupon) Object.assign(data, { discountType: null, discountValue: null, promoPriceInCents: null });
      else if (inline) Object.assign(data, { promoPriceInCents: null, couponId: null });

      // Undefined is an omitted patch; explicit null clears a descriptor field.
      if (["startsAt", "endsAt", "discountType", "discountValue", "promoPriceInCents", "couponId"].some(key => Object.hasOwn(data, key))) {
        ProductPromotionEntity.create({
          ...existing, ...data,
          discountType: (Object.hasOwn(data, "discountType") ? data.discountType : existing.discountType) as "percent" | "fixed" | null | undefined,
        });
      }

      return await this.repo.update(input.id, input.merchantId, data);
    } catch (err) {
      if (err instanceof Error && err.message.startsWith("promotion_")) {
        throw new ConflictException(err.message);
      }
      throw err;
    }
  }
}
