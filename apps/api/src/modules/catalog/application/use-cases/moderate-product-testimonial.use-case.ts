import { Inject, Injectable, Logger, Optional } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import {
  PRODUCT_TESTIMONIAL_REPOSITORY,
  ProductTestimonialRepositoryPort,
} from "../../domain/ports/product-testimonial-repository.port.js";
import { ProductTestimonialEntity } from "../../domain/entities/product-testimonial.entity.js";
import { DOMAIN_EVENT_BUS, type DomainEventBus } from "../../../../shared/events/domain-event-bus.port.js";
import { ProductContentMetricsService } from "../services/product-content-metrics.service.js";

/**
 * Wave 2 moderation use-case. Wraps repo approve/reject so we can:
 *  - Emit `product.testimonial.published` ONLY when the row transitions to
 *    `approved` AND `isPublished` is true (the storefront-visible state).
 *  - Fire a metric counter per approval for the R12 dashboard.
 *  - Always include `merchantId` so CDN purge + analytics stay tenant-scoped.
 *
 * Rejection is silent (no event) — moderation actions aren't user-visible on
 * the storefront, and we don't want to leak the queue depth to subscribers.
 *
 * `recordSubmission` exists so the buyer-side `SubmitCustomerTestimonialUseCase`
 * (Wave 3) can fan out the same metric + event shape without duplicating logic.
 */
@Injectable()
export class ModerateProductTestimonialUseCase {
  private readonly logger = new Logger(ModerateProductTestimonialUseCase.name);

  constructor(
    @Inject(PRODUCT_TESTIMONIAL_REPOSITORY)
    private readonly testimonialRepo: ProductTestimonialRepositoryPort,
    private readonly metrics: ProductContentMetricsService,
    @Optional() @Inject(DOMAIN_EVENT_BUS)
    private readonly eventBus?: DomainEventBus
  ) {}

  async approve(input: {
    merchantId: string;
    id: string;
    actor: { id: string; merchantId: string };
  }): Promise<ProductTestimonialEntity> {
    const updated = await this.testimonialRepo.approve(
      { merchantId: input.merchantId, id: input.id },
      input.actor
    );

    this.metrics.recordTestimonialApproved(
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
  }): Promise<ProductTestimonialEntity> {
    const updated = await this.testimonialRepo.reject(
      { merchantId: input.merchantId, id: input.id },
      input.actor
    );
    // No event: rejections are not storefront-visible.
    return updated;
  }

  async recordSubmission(input: {
    merchantId: string;
    testimonial: ProductTestimonialEntity;
  }): Promise<void> {
    this.metrics.recordTestimonialSubmitted(
      input.merchantId,
      input.testimonial.productId,
      input.testimonial.id
    );
    if (this.eventBus) {
      await this.eventBus
        .publish({
          eventId: randomUUID(),
          schemaVersion: 1,
          eventType: "product.testimonial.submitted",
          merchantId: input.merchantId,
          payload: {
            productId: input.testimonial.productId,
            testimonialId: input.testimonial.id,
            buyerId: input.testimonial.buyerId,
          },
        })
        .catch((err: unknown) => {
          const msg = err instanceof Error ? err.message : String(err);
          this.logger.warn(
            `event_publish_failed product.testimonial.submitted id=${input.testimonial.id}: ${msg}`
          );
        });
    }
  }

  private async publishEvent(
    merchantId: string,
    testimonial: ProductTestimonialEntity
  ): Promise<void> {
    if (!this.eventBus) return;
    await this.eventBus
      .publish({
        eventId: randomUUID(),
        schemaVersion: 1,
        eventType: "product.testimonial.published",
        merchantId,
        payload: {
          productId: testimonial.productId,
          testimonialId: testimonial.id,
          source: testimonial.source,
        },
      })
      .catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.warn(
          `event_publish_failed product.testimonial.published id=${testimonial.id}: ${msg}`
        );
      });
  }
}
