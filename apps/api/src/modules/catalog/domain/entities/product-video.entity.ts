/**
 * ProductVideoEntity
 *
 * One video attached to a Product. The entity is pure: it carries no Prisma or
 * NestJS dependency. Repositories hydrate rows into this shape via
 * `rehydrate()`.
 *
 * URLs are validated at the validator/wire boundary — this entity only checks
 * shape and required fields. Moderation status is `pending` by default for
 * customer-submitted videos; merchant-uploaded videos default to `approved`.
 *
 * Immutable: transformation methods return NEW instances.
 */

export type ProductVideoSource = "merchant" | "customer";
export type ProductModerationStatus = "pending" | "approved" | "rejected";

export interface ProductVideoProps {
  id: string;
  productId: string;
  title: string;
  videoUrl: string;
  thumbnailUrl?: string | null;
  durationSeconds?: number | null;
  source: ProductVideoSource;
  buyerId?: string | null;
  orderId?: string | null;
  moderationStatus: ProductModerationStatus;
  isPublished: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export class ProductVideoEntity {
  readonly id: string;
  readonly productId: string;
  readonly title: string;
  readonly videoUrl: string;
  readonly thumbnailUrl?: string | null;
  readonly durationSeconds?: number | null;
  readonly source: ProductVideoSource;
  readonly buyerId?: string | null;
  readonly orderId?: string | null;
  readonly moderationStatus: ProductModerationStatus;
  readonly isPublished: boolean;
  readonly createdAt: Date;
  readonly updatedAt: Date;

  private constructor(props: ProductVideoProps) {
    this.id = props.id;
    this.productId = props.productId;
    this.title = props.title;
    this.videoUrl = props.videoUrl;
    this.thumbnailUrl = props.thumbnailUrl;
    this.durationSeconds = props.durationSeconds;
    this.source = props.source;
    this.buyerId = props.buyerId;
    this.orderId = props.orderId;
    this.moderationStatus = props.moderationStatus;
    this.isPublished = props.isPublished;
    this.createdAt = props.createdAt;
    this.updatedAt = props.updatedAt;
  }

  static rehydrate(props: ProductVideoProps): ProductVideoEntity {
    if (!props.id || props.id.length === 0) {
      throw new Error("product_video_id_required");
    }
    if (!props.productId || props.productId.length === 0) {
      throw new Error("product_video_product_id_required");
    }
    if (!props.title || props.title.trim().length === 0) {
      throw new Error("product_video_title_required");
    }
    if (!props.videoUrl || props.videoUrl.trim().length === 0) {
      throw new Error("product_video_url_required");
    }
    if (
      props.source !== "merchant" &&
      props.source !== "customer"
    ) {
      throw new Error(`product_video_invalid_source:${String(props.source)}`);
    }
    if (
      props.moderationStatus !== "pending" &&
      props.moderationStatus !== "approved" &&
      props.moderationStatus !== "rejected"
    ) {
      throw new Error(
        `product_video_invalid_moderation_status:${String(props.moderationStatus)}`,
      );
    }
    if (
      props.durationSeconds !== null &&
      props.durationSeconds !== undefined &&
      (props.durationSeconds < 0 || !Number.isFinite(props.durationSeconds))
    ) {
      throw new Error("product_video_invalid_duration");
    }

    return new ProductVideoEntity(props);
  }

  approve(): ProductVideoEntity {
    if (this.moderationStatus === "approved") return this;
    return this.with({ moderationStatus: "approved", updatedAt: new Date() });
  }

  reject(): ProductVideoEntity {
    if (this.moderationStatus === "rejected") return this;
    return this.with({ moderationStatus: "rejected", updatedAt: new Date() });
  }

  publish(): ProductVideoEntity {
    if (this.isPublished) return this;
    return this.with({ isPublished: true, updatedAt: new Date() });
  }

  unpublish(): ProductVideoEntity {
    if (!this.isPublished) return this;
    return this.with({ isPublished: false, updatedAt: new Date() });
  }

  private with(patch: Partial<ProductVideoProps>): ProductVideoEntity {
    return new ProductVideoEntity({ ...this.toProps(), ...patch });
  }

  private toProps(): ProductVideoProps {
    return {
      id: this.id,
      productId: this.productId,
      title: this.title,
      videoUrl: this.videoUrl,
      thumbnailUrl: this.thumbnailUrl,
      durationSeconds: this.durationSeconds,
      source: this.source,
      buyerId: this.buyerId,
      orderId: this.orderId,
      moderationStatus: this.moderationStatus,
      isPublished: this.isPublished,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
    };
  }
}
