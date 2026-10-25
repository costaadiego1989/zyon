import { Injectable, Inject, Logger, Optional } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { ProductRepositoryPort } from "../../domain/ports/product-repository.port.js";
import { CorrelationIdStorage } from "../../../../shared/logger/correlation-id.storage.js";
import { DOMAIN_EVENT_BUS, type DomainEventBus } from "../../../../shared/events/domain-event-bus.port.js";

@Injectable()
export class DeleteProductUseCase {
  private readonly logger = new Logger(DeleteProductUseCase.name);

  constructor(
    @Inject("ProductRepositoryPort") private readonly productRepo: ProductRepositoryPort,
    @Optional() @Inject(DOMAIN_EVENT_BUS) private readonly eventBus?: DomainEventBus,
  ) {}

  async execute(merchantId: string, productId: string): Promise<void> {
    await this.productRepo.softDelete(merchantId, productId);

    // Emit domain event for marketplace sync (remove from federated index)
    this.eventBus?.publish({
      eventId: randomUUID(),
      schemaVersion: 1,
      eventType: "product.deleted",
      merchantId,
      payload: { productId },
    }).catch((err) => {
      this.logger.warn(`Event publish failed for deleted product ${productId}: ${err.message}`);
    });
  }
}
