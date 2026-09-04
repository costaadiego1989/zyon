import { Injectable, Inject, NotFoundException , Logger} from "@nestjs/common";
import { ProductRepositoryPort } from "../../domain/ports/product-repository.port.js";
import { ProductEntity } from "../../domain/entities/product.entity.js";
import { CorrelationIdStorage } from "../../../../shared/logger/correlation-id.storage.js";

@Injectable()
export class GetProductUseCase {
  private readonly logger = new Logger(GetProductUseCase.name);

  constructor(@Inject("ProductRepositoryPort") private readonly productRepo: ProductRepositoryPort) {}

  async execute(merchantId: string, productId: string): Promise<ProductEntity> {
    const product = await this.productRepo.findById(merchantId, productId);
    if (!product) throw new NotFoundException("product_not_found");
    return product;
  }
}
