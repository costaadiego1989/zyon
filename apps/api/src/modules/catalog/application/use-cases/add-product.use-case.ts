import { Injectable, Inject, ConflictException, Logger, Optional } from "@nestjs/common";
import { ProductRepositoryPort, CreateProductInput } from "../../domain/ports/product-repository.port.js";
import { ProductEntity } from "../../domain/entities/product.entity.js";
import { GenerateProductSeoUseCase } from "./generate-product-seo.use-case.js";
import { DOMAIN_EVENT_BUS, type DomainEventBus } from "../../../../shared/events/domain-event-bus.port.js";

@Injectable()
export class AddProductUseCase {
  private readonly logger = new Logger(AddProductUseCase.name);

  constructor(
    @Inject("ProductRepositoryPort") private readonly productRepo: ProductRepositoryPort,
    private readonly generateSeo: GenerateProductSeoUseCase,
    @Optional() @Inject(DOMAIN_EVENT_BUS) private readonly eventBus?: DomainEventBus,
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

    // SKU is the inventory/ERP key — it must be unique per merchant. Reject
    // duplicates both WITHIN this payload and against SKUs already used by other
    // products of the merchant. Without this, two products can share a SKU, the
    // inventory snapshot (keyed by merchant+sku) collapses them into one, and a
    // sale decrements the wrong stock / collides on ERP sync.
    const skus = input.variants.map((v) => v.sku.trim());
    const dupInPayload = skus.find((s, i) => skus.indexOf(s) !== i);
    if (dupInPayload) {
      throw new ConflictException(`duplicate_sku_in_product:${dupInPayload}`);
    }
    const existing = await this.productRepo.findExistingVariantSkus(input.merchantId, skus);
    if (existing.length > 0) {
      throw new ConflictException(`sku_already_exists:${existing.join(",")}`);
    }

    // Physical products require dimensions for shipping calculation
    const productType = input.type ?? "physical";
    const requiresDimensions = productType === "physical";
    if (requiresDimensions) {
      for (const variant of input.variants) {
        if (!variant.weightGrams || variant.weightGrams <= 0) {
          throw new ConflictException("physical_product_requires_weight");
        }
      }
    }

    const product = await this.productRepo.create(input);

    // Emit domain event for marketplace sync
    this.eventBus?.publish({
      eventType: "product.upserted",
      merchantId: product.merchantId,
      payload: {
        id: product.id,
        name: product.name,
        description: product.description,
        category: product.categoryId,
        priceCents: product.variants?.[0]?.basePriceInCents ?? 0,
        currency: product.variants?.[0]?.currency ?? "BRL",
        stockAvailable: true,
        isActive: true,
      },
    }).catch((err) => {
      this.logger.warn(`Event publish failed for product ${product.id}: ${err.message}`);
    });

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
