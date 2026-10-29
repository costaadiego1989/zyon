import { Inject, Injectable, Optional } from "@nestjs/common";

/**
 * Application-layer metrics port for product content events.
 *
 * Defined here (not in `domain/ports/`) because counters are an
 * infrastructure concern, not a domain invariant. No-op when no adapter is
 * wired, so unit tests can run without a metrics backend.
 *
 * Counter names follow `product.content.<verb>` so they group cleanly in
 * observability dashboards. All increments are tagged with `merchantId`
 * (and `productId` when meaningful) to respect tenant boundary.
 */
export const PRODUCT_CONTENT_METRICS = Symbol("PRODUCT_CONTENT_METRICS");

export interface ProductContentMetricsPort {
  /** Increment a single counter with optional dimensional tags. */
  increment(name: string, tags?: Record<string, string>): void;
}

export const NOOP_PRODUCT_CONTENT_METRICS: ProductContentMetricsPort = {
  increment: () => {
    /* no-op */
  },
};

/**
 * Convenience wrapper so use-cases don't repeat tag shape.
 * Every counter tag includes `merchantId` (and `productId` when available)
 * so the observability backend can enforce tenant-scoped dashboards.
 */
@Injectable()
export class ProductContentMetricsService {
  constructor(
    @Optional() @Inject(PRODUCT_CONTENT_METRICS)
    private readonly metrics: ProductContentMetricsPort = NOOP_PRODUCT_CONTENT_METRICS
  ) {}

  recordBlockPublished(merchantId: string, productId: string, blockType: string): void {
    this.metrics.increment("product.content.block_published", {
      merchantId,
      productId,
      blockType,
    });
  }

  recordFaqCreated(merchantId: string, productId: string, faqId: string): void {
    this.metrics.increment("product.content.faq_created", {
      merchantId,
      productId,
      faqId,
    });
  }

  recordFaqPublished(merchantId: string, productId: string, faqId: string): void {
    this.metrics.increment("product.content.faq_published", {
      merchantId,
      productId,
      faqId,
    });
  }

  recordTestimonialApproved(merchantId: string, productId: string, testimonialId: string): void {
    this.metrics.increment("product.content.testimonial_approved", {
      merchantId,
      productId,
      testimonialId,
    });
  }

  recordTestimonialSubmitted(merchantId: string, productId: string, testimonialId: string): void {
    this.metrics.increment("product.content.testimonial_submitted", {
      merchantId,
      productId,
      testimonialId,
    });
  }

  recordVideoApproved(merchantId: string, productId: string, videoId: string): void {
    this.metrics.increment("product.content.video_approved", {
      merchantId,
      productId,
      videoId,
    });
  }

  recordContentViewed(merchantId: string, productId: string): void {
    this.metrics.increment("product.content.viewed", {
      merchantId,
      productId,
    });
  }

  recordContentUpdated(merchantId: string, productId: string, enabledBlockCount: number): void {
    this.metrics.increment("product.content.updated", {
      merchantId,
      productId,
      // Tag values are strings; round to keep cardinality bounded.
      blockCountBucket: this.bucketize(enabledBlockCount),
    });
  }

  private bucketize(n: number): string {
    if (n <= 0) return "0";
    if (n <= 5) return "1-5";
    if (n <= 15) return "6-15";
    if (n <= 50) return "16-50";
    return "50+";
  }
}
