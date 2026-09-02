import { Injectable, Inject, Logger } from "@nestjs/common";
import {
  PRODUCT_PROMOTION_REPOSITORY,
  type ProductPromotionRepositoryPort,
  type ProductPromotionEntity as ProductPromotionSnapshot,
} from "../../domain/ports/product-promotion-repository.port.js";

@Injectable()
export class ToggleProductPromotionUseCase {
  private readonly logger = new Logger(ToggleProductPromotionUseCase.name);

  constructor(
    @Inject(PRODUCT_PROMOTION_REPOSITORY)
    private readonly repo: ProductPromotionRepositoryPort
  ) {}

  async execute(input: {
    id: string;
    merchantId: string;
    isActive: boolean;
  }): Promise<ProductPromotionSnapshot> {
    return await this.repo.update(input.id, input.merchantId, {
      isActive: input.isActive,
    });
  }
}
