import { Injectable, ForbiddenException, ConflictException } from "@nestjs/common";
import { ProductRepositoryPort, CreateProductInput } from "../../domain/ports/product-repository.port.js";
import { ProductEntity } from "../../domain/entities/product.entity.js";

@Injectable()
export class AddProductUseCase {
  constructor(private readonly productRepo: ProductRepositoryPort) {}

  async execute(input: CreateProductInput): Promise<ProductEntity> {
    if (!input.name?.trim()) {
      throw new ConflictException("product_name_required");
    }

    if (!input.variants?.length) {
      throw new ConflictException("at_least_one_variant_required");
    }

    for (const variant of input.variants) {
      if (!variant.sku?.trim()) throw new ConflictException("variant_sku_required");
      if (variant.basePriceInCents <= 0) throw new ConflictException("price_must_be_positive");
    }

    return this.productRepo.create(input);
  }
}
