import { Inject, Injectable, Logger, Optional } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import {
  PRODUCT_VIDEO_REPOSITORY,
  ProductVideoRepositoryPort,
} from "../../domain/ports/product-video-repository.port.js";
import { ProductVideoEntity } from "../../domain/entities/product-video.entity.js";
import { assertSafeUrl } from "../../domain/services/product-content-validator.service.js";
import { DOMAIN_EVENT_BUS, type DomainEventBus } from "../../../../shared/events/domain-event-bus.port.js";

/**
 * Wave 3 — Buyer-side video submission (R4 of the Advanced Product Layout
 * spec). Accepts an anonymous video URL from the storefront, validates input,
 * persists as `customer` + `moderationStatus='pending'`, and emits a
 * `product.testimonial.submitted`-flavored outbox event so the moderation
 * queue refreshes. We reuse `product.testimonial.submitted` because the
 * `product.video.submitted` event type isn't yet in the catalog event union;
 * the payload discriminator (`videoId` vs `testimonialId`) and the merchantId
 * keep downstream subscribers tenant-safe.
 *
 * URL safety reuses `assertSafeUrl` from ProductContentValidatorService. That
 * helper enforces http(s) only and rejects javascript:/data:/vbscript:. The
 * product-spec R4 also asks for an allowlist of providers (YouTube, Vimeo,
 * MP4 direct). v1 keeps the broader http(s) gate here; provider-specific
 * checks belong at the moderation step (merchant can reject YouTube links if
 * their storefront disallows them).
 *
 * Outbox durability matches SubmitCustomerTestimonialUseCase: the publish
 * happens after the Prisma write and is wrapped in `.catch(...)` so a bus
 * outage does not roll back the submission.
 */
@Injectable()
export class SubmitCustomerVideoUseCase {
  private readonly logger = new Logger(SubmitCustomerVideoUseCase.name);

  constructor(
    @Inject(PRODUCT_VIDEO_REPOSITORY)
    private readonly videoRepo: ProductVideoRepositoryPort,
    @Optional() @Inject(DOMAIN_EVENT_BUS)
    private readonly eventBus?: DomainEventBus
  ) {}

  async execute(input: {
    merchantId: string;
    productId: string;
    title: string;
    videoUrl: string;
    thumbnailUrl?: string | null;
    durationSeconds?: number | null;
    buyerId?: string | null;
  }): Promise<ProductVideoEntity> {
    const title = (input.title ?? "").trim();
    if (title.length === 0) {
      throw new Error("product_video_title_required");
    }
    if (title.length > 200) {
      throw new Error("product_video_title_too_long");
    }

    const videoUrl = (input.videoUrl ?? "").trim();
    if (videoUrl.length === 0) {
      throw new Error("product_video_url_required");
    }
    // Throws on javascript:/data:/vbscript:/non-http schemes or malformed URLs.
    assertSafeUrl(videoUrl);

    if (input.thumbnailUrl !== undefined && input.thumbnailUrl !== null && input.thumbnailUrl !== "") {
      assertSafeUrl(input.thumbnailUrl);
    }

    if (input.durationSeconds !== undefined && input.durationSeconds !== null) {
      const duration = Number(input.durationSeconds);
      if (!Number.isFinite(duration) || duration < 0) {
        throw new Error("product_video_invalid_duration");
      }
      input.durationSeconds = duration;
    }

    const created = await this.videoRepo.create(
      {
        merchantId: input.merchantId,
        productId: input.productId,
        title,
        videoUrl,
        thumbnailUrl: input.thumbnailUrl ?? null,
        durationSeconds: input.durationSeconds ?? null,
        source: "customer",
        buyerId: input.buyerId ?? null,
        isPublished: false,
        moderationStatus: "pending",
      },
      {
        id: input.buyerId ?? "anonymous",
        merchantId: input.merchantId,
        isBuyer: true,
      }
    );

    if (this.eventBus) {
      await this.eventBus
        .publish({
          eventId: randomUUID(),
          schemaVersion: 1,
          // Reuse the testimonial-submitted union member until
          // product.video.submitted lands in the catalog event union.
          // Subscribers key on eventType + payload discriminator.
          eventType: "product.testimonial.submitted",
          merchantId: input.merchantId,
          payload: {
            productId: created.productId,
            videoId: created.id,
            buyerId: created.buyerId,
          },
        })
        .catch((err) => {
          this.logger.warn(
            `event_publish_failed product.video.submitted id=${created.id}: ${
              err instanceof Error ? err.message : String(err)
            }`
          );
        });
    }

    return created;
  }
}
