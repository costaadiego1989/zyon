import { Injectable, Inject, Logger, Optional } from "@nestjs/common";
import { ProductRepositoryPort } from "../../domain/ports/product-repository.port.js";
import { ProductEntity } from "../../domain/entities/product.entity.js";
import { CorrelationIdStorage } from "../../../../shared/logger/correlation-id.storage.js";
import { DOMAIN_EVENT_BUS, type DomainEventBus } from "../../../../shared/events/domain-event-bus.port.js";

export interface UpdateProductInput {
  merchantId: string;
  productId: string;
  name?: string;
  description?: string;
  type?: string;
  metadata?: Record<string, unknown>;
  categoryId?: string;
  isActive?: boolean;
  seoTitle?: string;
  metaDescription?: string;
  slug?: string;
  ogTitle?: string;
  ogDescription?: string;
  twitterCard?: string;
  keywords?: string[];
}

@Injectable()
export class UpdateProductUseCase {
  private readonly logger = new Logger(UpdateProductUseCase.name);

  constructor(
    @Inject("ProductRepositoryPort") private readonly productRepo: ProductRepositoryPort,
    @Optional() @Inject(DOMAIN_EVENT_BUS) private readonly eventBus?: DomainEventBus,
  ) {}

  async execute(input: UpdateProductInput): Promise<ProductEntity> {
    const data: Partial<{ name: string; description: string; type: string; metadata: Record<string, unknown>; categoryId: string; isActive: boolean; seoTitle: string; metaDescription: string; slug: string; ogTitle: string; ogDescription: string; twitterCard: string; keywords: string[] }> = {};
    if (input.name !== undefined) data.name = input.name;
    if (input.description !== undefined) data.description = input.description;
    if (input.type !== undefined) data.type = input.type;
    if (input.metadata !== undefined) data.metadata = input.metadata;
    if (input.categoryId !== undefined) data.categoryId = input.categoryId;
    if (input.isActive !== undefined) data.isActive = input.isActive;
    if (input.seoTitle !== undefined) data.seoTitle = input.seoTitle;
    if (input.metaDescription !== undefined) data.metaDescription = input.metaDescription;
    if (input.slug !== undefined) data.slug = input.slug;
    if (input.ogTitle !== undefined) data.ogTitle = input.ogTitle;
    if (input.ogDescription !== undefined) data.ogDescription = input.ogDescription;
    if (input.twitterCard !== undefined) data.twitterCard = input.twitterCard;
    if (input.keywords !== undefined) data.keywords = input.keywords;

    const product = await this.productRepo.update(input.merchantId, input.productId, data);

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
        isActive: product.isActive,
      },
    }).catch((err) => {
      this.logger.warn(`Event publish failed for product ${product.id}: ${err.message}`);
    });

    return product;
  }
}
