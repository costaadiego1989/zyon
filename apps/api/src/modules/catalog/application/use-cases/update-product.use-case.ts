import { Injectable, Inject } from "@nestjs/common";
import { ProductRepositoryPort } from "../../domain/ports/product-repository.port.js";
import { ProductEntity } from "../../domain/entities/product.entity.js";

export interface UpdateProductInput {
  merchantId: string;
  productId: string;
  name?: string;
  description?: string;
  categoryId?: string;
  isActive?: boolean;
}

@Injectable()
export class UpdateProductUseCase {
  constructor(@Inject("ProductRepositoryPort") private readonly productRepo: ProductRepositoryPort) {}

  async execute(input: UpdateProductInput): Promise<ProductEntity> {
    const data: Partial<{ name: string; description: string; categoryId: string; isActive: boolean }> = {};
    if (input.name !== undefined) data.name = input.name;
    if (input.description !== undefined) data.description = input.description;
    if (input.categoryId !== undefined) data.categoryId = input.categoryId;
    if (input.isActive !== undefined) data.isActive = input.isActive;
    return this.productRepo.update(input.merchantId, input.productId, data);
  }
}
