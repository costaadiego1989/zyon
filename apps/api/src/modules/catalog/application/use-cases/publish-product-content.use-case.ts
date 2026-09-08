import { Inject, Injectable, Logger, Optional } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import {
  PRODUCT_CONTENT_REPOSITORY,
  ProductContentRepositoryPort,
} from "../../domain/ports/product-content-repository.port.js";
import { ProductContentBlockEntity } from "../../domain/entities/product-content-block.entity.js";
import { DOMAIN_EVENT_BUS, type DomainEventBus } from "../../../../shared/events/domain-event-bus.port.js";
import { ProductContentMetricsService } from "../services/product-content-metrics.service.js";

/**
 * Bulk-replace the ordered blocks of a product's content surface and emit
 * `product.content.updated` so subscribers (CDN purge, analytics) can react.
 *
 * Wave 2 addition: counters per enabled block type for the `R12` telemetry
 * acceptance criterion. Tenant scoping enforced via merchantId on every call.
 *
 * Outbox durability: event publication goes through `eventBus.publish` AFTER
 * the prisma `replaceAll` transaction commits, matching the existing
 * `AddProductUseCase` / `UpdateProductUseCase` pattern. The dispatcher
 * (subscribed handlers like `ProductContentCdnPurgeHandler`) reacts in-process.
 */
@Injectable()
export class PublishProductContentUseCase {
  private readonly logger = new Logger(PublishProductContentUseCase.name);

  constructor(
    @Inject(PRODUCT_CONTENT_REPOSITORY)
    private readonly contentRepo: ProductContentRepositoryPort,
    private readonly metrics: ProductContentMetricsService,
    @Optional() @Inject(DOMAIN_EVENT_BUS)
    private readonly eventBus?: DomainEventBus
  ) {}

  async execute(input: {
    merchantId: string;
    productId: string;
    blocks: Parameters<ProductContentRepositoryPort["replaceAll"]>[0]["blocks"];
    variantIds?: readonly string[];
    source?: "dashboard_save" | "bulk_replace" | "auto_migration";
    /** Locale is forwarded to the repo if it accepts one (Wave 3 i18n). */
    locale?: string;
  }): Promise<ProductContentBlockEntity[]> {
    const repoInput = {
      merchantId: input.merchantId,
      productId: input.productId,
      blocks: input.blocks,
      ...(input.locale ? { locale: input.locale } : {}),
    };
    const saved = await this.contentRepo.replaceAll(repoInput as Parameters<ProductContentRepositoryPort["replaceAll"]>[0]);

    const enabledCount = saved.filter((b) => b.isEnabled).length;

    // Telemetry: 1 increment per enabled block by type (dashboard segmentation),
    // plus a single "content updated" rollup with bucket count.
    for (const block of saved) {
      if (!block.isEnabled) continue;
      this.metrics.recordBlockPublished(input.merchantId, input.productId, block.type);
    }
    this.metrics.recordContentUpdated(input.merchantId, input.productId, enabledCount);

    // Outbox-style event publication (consistent with AddProductUseCase /
    // UpdateProductUseCase): publish AFTER the prisma tx commits.
    // Subscribers (CDN purge handler, future analytics sinks) react via the
    // domain event bus; delivery is in-process and best-effort.
    if (this.eventBus) {
      const variantIds = input.variantIds ?? [];
      await this.eventBus
        .publish({
          eventId: randomUUID(),
          schemaVersion: 1,
          eventType: "product.content.updated",
          merchantId: input.merchantId,
          payload: {
            productId: input.productId,
            enabledBlockCount: enabledCount,
            variantIds,
            source: input.source ?? "dashboard_save",
          },
        })
        .catch((err: unknown) => {
          const msg = err instanceof Error ? err.message : String(err);
          this.logger.warn(
            `event_publish_failed product.content.updated product=${input.productId}: ${msg}`
          );
        });
    }

    return saved;
  }
}
