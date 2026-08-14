import { Injectable } from "@nestjs/common";
import { ProductRepositoryPort, SearchProductsInput, SearchProductsResult } from "../../domain/ports/product-repository.port.js";

@Injectable()
export class SearchProductsUseCase {
  constructor(private readonly productRepo: ProductRepositoryPort) {}

  async execute(input: SearchProductsInput): Promise<SearchProductsResult> {
    return this.productRepo.search({
      ...input,
      limit: Math.min(input.limit ?? 20, 100),
    });
  }
}
