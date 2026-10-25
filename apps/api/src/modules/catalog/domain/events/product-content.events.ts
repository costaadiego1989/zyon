/**
 * Domain events emitted by Advanced Product Layout (Wave 1 + Wave 2 hardening).
 *
 * Each event carries the tenant boundary (`merchantId`) so subscribers and the
 * outbox dispatcher can enforce isolation. `variantIds` is included when the
 * change scope is bounded to specific variants — CDN purge uses them to compute
 * cache keys.
 *
 * Notes on durability:
 * - These events flow through `DomainEventBus.publish(...)` after the
 *   underlying Prisma transaction commits (matches the existing catalog
 *   use-case pattern in `AddProductUseCase` / `UpdateProductUseCase` /
 *   `ModerateProduct*UseCase`). The in-process subscribers (CDN purge
 *   handler, metrics) react synchronously; future analytics sinks should
 *   subscribe via the durable outbox path.
 */

export type ProductContentEventType =
  | "product.content.updated"
  | "product.content.viewed"
  | "product.faq.published"
  | "product.testimonial.published"
  | "product.video.published"
  | "product.testimonial.submitted";

export interface ProductContentEventBase {
  merchantId: string;
  productId: string;
  /** Variant IDs whose storefront cache entries must be invalidated. */
  variantIds?: readonly string[];
}

export interface ProductContentUpdatedEvent extends ProductContentEventBase {
  type: "product.content.updated";
  /** Number of enabled blocks after the publish. */
  enabledBlockCount: number;
  /** Source of the change — useful for telemetry segmentation. */
  source: "dashboard_save" | "bulk_replace" | "auto_migration" | "revert";
}

export interface ProductContentViewedEvent extends ProductContentEventBase {
  type: "product.content.viewed";
}

export interface ProductFaqPublishedEvent extends ProductContentEventBase {
  type: "product.faq.published";
  faqId: string;
}

export interface ProductTestimonialPublishedEvent extends ProductContentEventBase {
  type: "product.testimonial.published";
  testimonialId: string;
  /** "curated" or "customer_submission". */
  source: string;
}

export interface ProductVideoPublishedEvent extends ProductContentEventBase {
  type: "product.video.published";
  videoId: string;
  source: "merchant" | "customer";
}

export interface ProductTestimonialSubmittedEvent extends ProductContentEventBase {
  type: "product.testimonial.submitted";
  testimonialId: string;
  /** Best-effort buyer identity for moderation prioritization. */
  buyerId?: string | null;
}

export type ProductContentEvent =
  | ProductContentUpdatedEvent
  | ProductContentViewedEvent
  | ProductFaqPublishedEvent
  | ProductTestimonialPublishedEvent
  | ProductVideoPublishedEvent
  | ProductTestimonialSubmittedEvent;
