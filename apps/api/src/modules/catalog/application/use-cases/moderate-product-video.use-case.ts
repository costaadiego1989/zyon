import { Inject, Injectable, Logger, Optional } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import {
  PRODUCT_VIDEO_REPOSITORY,
  ProductVideoRepositoryPort,
} from "../../domain/ports/product-video-repository.port.js";
import { ProductVideoEntity } from "../../domain/entities/product-video.entity.js";
import { DOMAIN_EVENT_BUS, type DomainEventBus } from "../../../../shared/events/domain-event-bus.port.js";
import { ProductContentMetricsService } from "../services/product-content-metrics.service.js";

/**
 * Wave 2 moderation use-case for videos. Same shape as the testimonial
 * counterpart: emit `product.video.published` only on approve+isPublished,
 * increment metrics, and stay tenant-scoped.
 */
@Injectable()
export class ModerateProductVideoUseCase {
  private readonly logger = new Logger(ModerateProductVideoUseCase.name);

  constructor(
    @Inject(PRODUCT_VIDEO_REPOSITORY)
    private readonly videoRepo: ProductVideoRepositoryPort,
    private readonly metrics: ProductContentMetricsService,
    @Optional() @Inject(DOMAIN_EVENT_BUS)
    private readonly eventBus?: DomainEventBus
  ) {}

  async approve(input: {
    merchantId: string;
    id: string;
    actor: { id: string; merchantId: string };
  }): Promise<ProductVideoEntity> {
    const updated = await this.videoRepo.approve(
      { merchantId: input.merchantId, id: input.id },
      input.actor
    );

    this.metrics.recordVideoApproved(
      input.merchantId,
      updated.productId,
      updated.id
    );

    if (updated.isPublished) {
      await this.publishEvent(input.merchantId, updated);
    }

    return updated;
  }

  async reject(input: {
    merchantId: string;
    id: string;
    actor: { id: string; merchantId: string };
  }): Promise<ProductVideoEntity> {
    const updated = await this.videoRepo.reject(
      { merchantId: input.merchantId, id: input.id },
      input.actor
    );
    return updated;
  }

  private async publishEvent(
    merchantId: string,
    video: ProductVideoEntity
  ): Promise<void> {
    if (!this.eventBus) return;
    await this.eventBus
      .publish({
        eventId: randomUUID(),
        schemaVersion: 1,
        eventType: "product.video.published",
        merchantId,
        payload: {
          productId: video.productId,
          videoId: video.id,
          source: video.source,
        },
      })
      .catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.warn(
          `event_publish_failed product.video.published id=${video.id}: ${msg}`
        );
      });
  }
}
