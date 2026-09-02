import { Injectable, Inject, Logger } from "@nestjs/common";
import {
  PRODUCT_PROMOTION_REPOSITORY,
  type ProductPromotionRepositoryPort,
} from "../../domain/ports/product-promotion-repository.port.js";

@Injectable()
export class DeleteProductPromotionUseCase {
  private readonly logger = new Logger(DeleteProductPromotionUseCase.name);

  constructor(
    @Inject(PRODUCT_PROMOTION_REPOSITORY)
    private readonly repo: ProductPromotionRepositoryPort
  ) {}

  async execute(input: { id: string; merchantId: string }): Promise<void> {
    await this.repo.delete(input.id, input.merchantId);
  }
}
