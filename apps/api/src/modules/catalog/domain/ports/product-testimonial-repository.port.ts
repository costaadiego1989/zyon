import type {
  ProductTestimonialEntity,
  TestimonialSource,
  ModerationStatus,
} from "../entities/product-testimonial.entity.js";

export const PRODUCT_TESTIMONIAL_REPOSITORY = Symbol(
  "PRODUCT_TESTIMONIAL_REPOSITORY",
);

export interface ProductTestimonialActor {
  id: string;
  merchantId: string;
  /** True when the actor is acting on behalf of a buyer, not the merchant. */
  isBuyer?: boolean;
}

export interface ProductTestimonialCreateInput {
  merchantId: string;
  productId: string;
  authorName: string;
  authorAvatarUrl?: string | null;
  body: string;
  rating?: number | null;
  source?: TestimonialSource;
  buyerId?: string | null;
  orderId?: string | null;
  isPublished?: boolean;
}

export interface ProductTestimonialUpdateInput {
  authorName?: string;
  authorAvatarUrl?: string | null;
  body?: string;
  rating?: number | null;
  isPublished?: boolean;
}

/**
 * Persistence port for per-product testimonials. Tenant scoping lives at
 * every method signature.
 */
export interface ProductTestimonialRepositoryPort {
  /** Public storefront view: approved & published only. */
  findApprovedByProduct(input: {
    productId: string;
    limit?: number;
  }): Promise<ProductTestimonialEntity[]>;

  /** Merchant-side: every testimonial for a product within a tenant. */
  listAllForMerchant(input: {
    merchantId: string;
    productId: string;
    status?: ModerationStatus;
  }): Promise<ProductTestimonialEntity[]>;

  create(input: ProductTestimonialCreateInput, actor: ProductTestimonialActor): Promise<ProductTestimonialEntity>;

  update(input: {
    merchantId: string;
    id: string;
    patch: ProductTestimonialUpdateInput;
  }): Promise<ProductTestimonialEntity>;

  delete(input: { merchantId: string; id: string }): Promise<void>;

  /** Move a testimonial to `approved`. Caller is responsible for tenant check. */
  approve(input: { merchantId: string; id: string }, actor: ProductTestimonialActor): Promise<ProductTestimonialEntity>;

  /** Move a testimonial to `rejected`. */
  reject(input: { merchantId: string; id: string }, actor: ProductTestimonialActor): Promise<ProductTestimonialEntity>;
}
