import type {
  ProductVideoEntity,
  ProductVideoSource,
  ProductModerationStatus,
} from "../entities/product-video.entity.js";

export const PRODUCT_VIDEO_REPOSITORY = Symbol("ProductVideoRepositoryPort");

export interface ProductVideoActor {
  id: string;
  merchantId: string;
  isBuyer?: boolean;
}

export interface ProductVideoCreateInput {
  merchantId: string;
  productId: string;
  title: string;
  videoUrl: string;
  thumbnailUrl?: string | null;
  durationSeconds?: number | null;
  source?: ProductVideoSource;
  buyerId?: string | null;
  isPublished?: boolean;
  locale?: string;
  /**
   * Initial moderation status. Defaults to `pending` because v1 ships with
   * the safest stance; merchant uploaders pass `approved` explicitly.
   */
  moderationStatus?: ProductModerationStatus;
}

export interface ProductVideoUpdateInput {
  title?: string;
  videoUrl?: string;
  thumbnailUrl?: string | null;
  durationSeconds?: number | null;
  isPublished?: boolean;
  moderationStatus?: ProductModerationStatus;
}

/**
 * Persistence port for per-product videos. Tenant scoping lives at every
 * method signature.
 */
export interface ProductVideoRepositoryPort {
  /** Public storefront view: approved & published only. */
  findApprovedByProduct(input: {
    productId: string;
    limit?: number;
    locale?: string;
  }): Promise<ProductVideoEntity[]>;

  /** Merchant-side: every video for a product within a tenant. */
  listAllForMerchant(input: {
    merchantId: string;
    productId: string;
    moderationStatus?: ProductModerationStatus;
    locale?: string;
  }): Promise<ProductVideoEntity[]>;

  create(input: ProductVideoCreateInput, actor: ProductVideoActor): Promise<ProductVideoEntity>;

  update(input: {
    merchantId: string;
    id: string;
    patch: ProductVideoUpdateInput;
  }): Promise<ProductVideoEntity>;

  delete(input: { merchantId: string; id: string }): Promise<void>;

  /** Move a video to `approved`. */
  approve(input: { merchantId: string; id: string }, actor: ProductVideoActor): Promise<ProductVideoEntity>;

  /** Move a video to `rejected`. */
  reject(input: { merchantId: string; id: string }, actor: ProductVideoActor): Promise<ProductVideoEntity>;
}
