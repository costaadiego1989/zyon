import { Injectable, Inject } from "@nestjs/common";
import { ProductRepositoryPort } from "../../domain/ports/product-repository.port.js";

@Injectable()
export class DeleteProductUseCase {
  constructor(@Inject("ProductRepositoryPort") private readonly productRepo: ProductRepositoryPort) {}

  async execute(merchantId: string, productId: string): Promise<void> {
    await this.productRepo.softDelete(merchantId, productId);
  }
}
