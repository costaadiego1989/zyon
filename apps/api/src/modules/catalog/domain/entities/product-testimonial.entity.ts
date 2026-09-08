/**
 * ProductTestimonialEntity
 *
 * One product-attached testimonial — either curated by the merchant or
 * submitted by a buyer (moderation-gated). Pure domain entity.
 *
 * Invariants enforced at rehydrate:
 *   - `body` is non-empty after trim.
 *   - `rating`, when present, is in [1, 5].
 *   - `locale` is normalized via `normalizeProductContentLocale`.
 *
 * Immutable: all transformation methods return a new instance.
 */

export type TestimonialSource = "curated" | "customer_submission";
export type ModerationStatus = "pending" | "approved" | "rejected";

/**
 * Re-exported so the testimonial repository can stay scoped to its own
 * entity file without reaching across to the block entity for helpers.
 */
export {
  DEFAULT_PRODUCT_CONTENT_LOCALE,
  normalizeProductContentLocale,
} from "./product-content-block.entity.js";

import {
  DEFAULT_PRODUCT_CONTENT_LOCALE,
  normalizeProductContentLocale,
} from "./product-content-block.entity.js";

export interface ProductTestimonialProps {
  id: string;
  productId: string;
  authorName: string;
  authorAvatarUrl?: string | null;
  body: string;
  rating?: number | null;
  source: TestimonialSource;
  buyerId?: string | null;
  orderId?: string | null;
  moderationStatus: ModerationStatus;
  isPublished: boolean;
  /** BCP-47 style locale tag; default `pt-BR`. */
  locale: string;
  createdAt: Date;
  updatedAt: Date;
}

export class ProductTestimonialEntity {
  readonly id: string;
  readonly productId: string;
  readonly authorName: string;
  readonly authorAvatarUrl: string | null;
  readonly body: string;
  readonly rating: number | null;
  readonly source: TestimonialSource;
  readonly buyerId: string | null;
  readonly orderId: string | null;
  readonly moderationStatus: ModerationStatus;
  readonly isPublished: boolean;
  readonly locale: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;

  private constructor(props: ProductTestimonialProps) {
    this.id = props.id;
    this.productId = props.productId;
    this.authorName = props.authorName;
    this.authorAvatarUrl = props.authorAvatarUrl ?? null;
    this.body = props.body;
    this.rating = props.rating ?? null;
    this.source = props.source;
    this.buyerId = props.buyerId ?? null;
    this.orderId = props.orderId ?? null;
    this.moderationStatus = props.moderationStatus;
    this.isPublished = props.isPublished;
    this.locale = normalizeProductContentLocale(props.locale);
    this.createdAt = props.createdAt;
    this.updatedAt = props.updatedAt;
  }

  static rehydrate(props: ProductTestimonialProps): ProductTestimonialEntity {
    if (!props.id || props.id.length === 0) {
      throw new Error("product_testimonial_id_required");
    }
    if (!props.productId || props.productId.length === 0) {
      throw new Error("product_testimonial_product_id_required");
    }
    if (typeof props.body !== "string" || props.body.trim().length === 0) {
      throw new Error("product_testimonial_body_empty");
    }
    if (props.authorName !== undefined && props.authorName !== null && props.authorName.length === 0) {
      throw new Error("product_testimonial_author_name_empty");
    }
    if (props.rating !== undefined && props.rating !== null && props.rating !== null) {
      if (props.rating < 1 || props.rating > 5) {
        throw new Error("product_testimonial_rating_out_of_range");
      }
    }
    if (props.source !== "curated" && props.source !== "customer_submission") {
      throw new Error("product_testimonial_invalid_source");
    }
    if (
      props.moderationStatus !== "pending" &&
      props.moderationStatus !== "approved" &&
      props.moderationStatus !== "rejected"
    ) {
      throw new Error("product_testimonial_invalid_moderation_status");
    }

    return new ProductTestimonialEntity(props);
  }

  approve(actorId?: string): ProductTestimonialEntity {
    return new ProductTestimonialEntity({
      ...this.snapshot(),
      moderationStatus: "approved",
      updatedAt: new Date(),
      // Approval is recorded via repository audit, not on the entity itself.
      // Accepting actorId here keeps the call-site typed for future logging.
      ...(actorId !== undefined ? {} : {}),
    });
  }

  reject(): ProductTestimonialEntity {
    return new ProductTestimonialEntity({
      ...this.snapshot(),
      moderationStatus: "rejected",
      updatedAt: new Date(),
    });
  }

  publish(): ProductTestimonialEntity {
    if (this.isPublished) return this;
    if (this.moderationStatus !== "approved") {
      throw new Error("product_testimonial_publish_requires_approval");
    }
    return new ProductTestimonialEntity({ ...this.snapshot(), isPublished: true, updatedAt: new Date() });
  }

  unpublish(): ProductTestimonialEntity {
    if (!this.isPublished) return this;
    return new ProductTestimonialEntity({ ...this.snapshot(), isPublished: false, updatedAt: new Date() });
  }

  /** Update mutable copy fields. Caller must ensure body is non-empty. */
  edit(input: { authorName?: string; authorAvatarUrl?: string | null; body?: string; rating?: number | null; locale?: string }): ProductTestimonialEntity {
    const next: ProductTestimonialProps = {
      ...this.snapshot(),
      updatedAt: new Date(),
    };
    if (input.authorName !== undefined) next.authorName = input.authorName;
    if (input.authorAvatarUrl !== undefined) next.authorAvatarUrl = input.authorAvatarUrl;
    if (input.body !== undefined) {
      if (input.body.trim().length === 0) {
        throw new Error("product_testimonial_body_empty");
      }
      next.body = input.body;
    }
    if (input.rating !== undefined) {
      if (input.rating !== null && (input.rating < 1 || input.rating > 5)) {
        throw new Error("product_testimonial_rating_out_of_range");
      }
      next.rating = input.rating;
    }
    if (input.locale !== undefined) {
      next.locale = normalizeProductContentLocale(input.locale);
    }
    return ProductTestimonialEntity.rehydrate(next);
  }

  private snapshot(): ProductTestimonialProps {
    return {
      id: this.id,
      productId: this.productId,
      authorName: this.authorName,
      authorAvatarUrl: this.authorAvatarUrl,
      body: this.body,
      rating: this.rating,
      source: this.source,
      buyerId: this.buyerId,
      orderId: this.orderId,
      moderationStatus: this.moderationStatus,
      isPublished: this.isPublished,
      locale: this.locale,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
    };
  }
}
