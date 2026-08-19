import { Injectable, Inject, OnModuleInit, Logger } from "@nestjs/common";
import { DOMAIN_EVENT_BUS, type DomainEventBus, type DomainEvent } from "../../../../shared/events/domain-event-bus.port.js";
import { PrismaFederatedProductRepository } from "../../infrastructure/repositories/prisma-federated-product.repository.js";
import { FEDERATED_PRODUCT_REPOSITORY } from "../../domain/ports/federated-product-repository.port.js";

/**
 * Subscribes to catalog domain events and keeps the federated product index
 * in sync. This is the event-driven alternative to the 5-min cron job.
 *
 * Pattern: Marketplace bounded context reacts to Catalog events.
 * When migrating to microservices, replace DomainEventBus subscription
 * with RabbitMQ/Kafka consumer — same handler logic, different transport.
 *
 * Events consumed:
 * - product.upserted → upsert in federated index (if marketplace enabled)
 * - product.deleted  → remove from federated index
 */
@Injectable()
export class MarketplaceCatalogSyncHandler implements OnModuleInit {
  private readonly logger = new Logger(MarketplaceCatalogSyncHandler.name);

  constructor(
    @Inject(DOMAIN_EVENT_BUS) private readonly eventBus: DomainEventBus,
    @Inject(FEDERATED_PRODUCT_REPOSITORY)
    private readonly federatedRepo: PrismaFederatedProductRepository,
  ) {}

  onModuleInit(): void {
    this.eventBus.subscribe(
      "product.upserted",
      (event) => this.handleProductUpserted(event),
      "marketplace.catalog-sync.upserted",
    );

    this.eventBus.subscribe(
      "product.deleted",
      (event) => this.handleProductDeleted(event),
      "marketplace.catalog-sync.deleted",
    );

    this.logger.log("Subscribed to product.upserted + product.deleted");
  }

  private async handleProductUpserted(event: DomainEvent): Promise<void> {
    const { merchantId, payload } = event;
    const product = payload as {
      id: string;
      name: string;
      description?: string;
      category?: string;
      priceCents: number;
      currency?: string;
      stockAvailable?: boolean;
      imageUrl?: string;
      isActive?: boolean;
      marketplaceVisible?: boolean;
    };

    // Only index if product is active and marketplace visible
    if (product.isActive === false || product.marketplaceVisible === false) {
      // Remove from index if it was there
      await this.federatedRepo.delete(merchantId, product.id);
      this.logger.debug(`Removed ${product.id} from federated index (inactive/hidden)`);
      return;
    }

    const searchableText = [product.name, product.description, product.category]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();

    await this.federatedRepo.upsert({
      sourceMerchantId: merchantId,
      sourceProductId: product.id,
      name: product.name,
      description: product.description ?? undefined,
      category: product.category ?? undefined,
      priceCents: product.priceCents,
      currency: product.currency ?? "BRL",
      stockAvailable: product.stockAvailable ?? true,
      imageUrl: product.imageUrl ?? undefined,
    });

    this.logger.debug(`Synced ${product.id} to federated index`);
  }

  private async handleProductDeleted(event: DomainEvent): Promise<void> {
    const { merchantId, payload } = event;
    const { productId } = payload as { productId: string };

    await this.federatedRepo.delete(merchantId, productId);
    this.logger.debug(`Removed ${productId} from federated index (deleted)`);
  }
}
