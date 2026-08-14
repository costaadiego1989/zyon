import { Injectable, Inject, NotFoundException } from "@nestjs/common";
import { ProductRepositoryPort } from "../../domain/ports/product-repository.port.js";
import { ProductEntity } from "../../domain/entities/product.entity.js";

@Injectable()
export class GetProductUseCase {
  constructor(@Inject("ProductRepositoryPort") private readonly productRepo: ProductRepositoryPort) {}

  async execute(merchantId: string, productId: string): Promise<ProductEntity> {
    const product = await this.productRepo.findById(merchantId, productId);
    if (!product) throw new NotFoundException("product_not_found");
    return product;
  }
}
