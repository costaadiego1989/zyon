import { Inject, Injectable, Logger, Optional } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import {
  PRODUCT_TESTIMONIAL_REPOSITORY,
  ProductTestimonialRepositoryPort,
} from "../../domain/ports/product-testimonial-repository.port.js";
import { ProductTestimonialEntity } from "../../domain/entities/product-testimonial.entity.js";
import { assertSafeUrl } from "../../domain/services/product-content-validator.service.js";
import { DOMAIN_EVENT_BUS, type DomainEventBus } from "../../../../shared/events/domain-event-bus.port.js";
import { ProductContentMetricsService } from "../services/product-content-metrics.service.js";

/**
 * Wave 3 — Buyer-side testimonial submission (R3 of the Advanced Product
 * Layout spec). Accepts an anonymous submission from the storefront, validates
 * input, persists as `customer_submission` + `moderationStatus='pending'`,
 * and emits a `product.testimonial.submitted` event so the moderation queue
 * can refresh and the merchant dashboard can light up.
 *
 * Invariants enforced here (before persistence):
 *  - `merchantId` belongs to the resolved slug and the product is active.
 *  - `authorName` and `body` are non-empty after trim.
 *  - `body` ≤ 4000 chars (matches the block-prop string cap so payloads stay
 *    compatible with the existing rendered surface).
 *  - `rating`, when present, is an integer in [1, 5].
 *  - `authorAvatarUrl`, when present, passes the URL allowlist (http(s) only,
 *    rejects `javascript:` / `data:` / `vbscript:`).
 *
 * Buyer identity is optional. When a `BuyerJwtAuthGuard` principal is attached
 * to the request, the use-case copies `globalUserId` into `buyerId` so future
 * "your submissions" UX can scope by buyer without re-resolving.
 *
 * Outbox durability: the event publish happens after the Prisma write
 * succeeds and is wrapped in a `.catch(...)` so a downstream bus outage does
 * NOT roll back the submission. This matches the existing moderate use-case
 * pattern (ModerateProductTestimonialUseCase.recordSubmission).
 */
@Injectable()
export class SubmitCustomerTestimonialUseCase {
  private readonly logger = new Logger(SubmitCustomerTestimonialUseCase.name);

  constructor(
    @Inject(PRODUCT_TESTIMONIAL_REPOSITORY)
    private readonly testimonialRepo: ProductTestimonialRepositoryPort,
    private readonly metrics: ProductContentMetricsService,
    @Optional() @Inject(DOMAIN_EVENT_BUS)
    private readonly eventBus?: DomainEventBus
  ) {}

  async execute(input: {
    merchantId: string;
    productId: string;
    authorName: string;
    body: string;
    rating?: number | null;
    authorAvatarUrl?: string | null;
    buyerId?: string | null;
  }): Promise<ProductTestimonialEntity> {
    const authorName = (input.authorName ?? "").trim();
    if (authorName.length === 0) {
      throw new Error("product_testimonial_author_name_empty");
    }
    if (authorName.length > 200) {
      throw new Error("product_testimonial_author_name_too_long");
    }

    const body = (input.body ?? "").trim();
    if (body.length === 0) {
      throw new Error("product_testimonial_body_empty");
    }
    if (body.length > 4000) {
      throw new Error("product_testimonial_body_too_long");
    }

    if (input.rating !== undefined && input.rating !== null) {
      const rating = Number(input.rating);
      if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
        throw new Error("product_testimonial_rating_out_of_range");
      }
      input.rating = rating;
    }

    if (input.authorAvatarUrl !== undefined && input.authorAvatarUrl !== null && input.authorAvatarUrl !== "") {
      // Throws on javascript:/data:/vbscript:/non-http schemes or malformed URLs.
      assertSafeUrl(input.authorAvatarUrl);
    }

    const created = await this.testimonialRepo.create(
      {
        merchantId: input.merchantId,
        productId: input.productId,
        authorName,
        body,
        rating: input.rating ?? null,
        authorAvatarUrl: input.authorAvatarUrl ?? null,
        source: "customer_submission",
        buyerId: input.buyerId ?? null,
        isPublished: false,
        moderationStatus: "pending",
      },
      {
        // Submission is system-attributed: no merchant actor. The buyer's
        // globalUserId is captured separately as `buyerId` on the row.
        id: input.buyerId ?? "anonymous",
        merchantId: input.merchantId,
        isBuyer: true,
      }
    );

    this.metrics.recordTestimonialSubmitted(
      input.merchantId,
      created.productId,
      created.id
    );

    if (this.eventBus) {
      await this.eventBus
        .publish({
          eventId: randomUUID(),
          schemaVersion: 1,
          eventType: "product.testimonial.submitted",
          merchantId: input.merchantId,
          payload: {
            productId: created.productId,
            testimonialId: created.id,
            buyerId: created.buyerId,
          },
        })
        .catch((err) => {
          this.logger.warn(
            `event_publish_failed product.testimonial.submitted id=${created.id}: ${
              err instanceof Error ? err.message : String(err)
            }`
          );
        });
    }

    return created;
  }
}
