import { Injectable, Inject, ConflictException, Logger } from "@nestjs/common";
import { ProductRepositoryPort, CreateProductInput } from "../../domain/ports/product-repository.port.js";
import { ProductEntity } from "../../domain/entities/product.entity.js";
import { GenerateProductSeoUseCase } from "./generate-product-seo.use-case.js";

@Injectable()
export class AddProductUseCase {
  private readonly logger = new Logger(AddProductUseCase.name);

  constructor(
    @Inject("ProductRepositoryPort") private readonly productRepo: ProductRepositoryPort,
    private readonly generateSeo: GenerateProductSeoUseCase,
  ) {}

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

    const product = await this.productRepo.create(input);

    // Auto-generate SEO in background (non-blocking, best-effort)
    this.autoGenerateSeo(product.merchantId, product.id).catch((err) => {
      this.logger.warn(`Auto SEO generation failed for product ${product.id}: ${err.message}`);
    });

    return product;
  }

  private async autoGenerateSeo(merchantId: string, productId: string): Promise<void> {
    const seo = await this.generateSeo.execute({ merchantId, productId });
    await this.productRepo.update(merchantId, productId, {
      seoTitle: seo.seoTitle,
      metaDescription: seo.metaDescription,
      slug: seo.slug,
      ogTitle: seo.ogTitle,
      ogDescription: seo.ogDescription,
      keywords: seo.keywords,
    });
  }
}
