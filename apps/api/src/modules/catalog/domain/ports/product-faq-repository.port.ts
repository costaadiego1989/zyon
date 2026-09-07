import { ProductFaqEntity } from "../entities/product-faq.entity.js";

export const PRODUCT_FAQ_REPOSITORY = Symbol("ProductFaqRepositoryPort");

export interface ProductFaqActor {
  id: string;
  merchantId: string;
}

export interface ProductFaqCreateInput {
  merchantId: string;
  productId: string;
  question: string;
  answer: string;
  order?: number;
  isPublished?: boolean;
}

export interface ProductFaqUpdateInput {
  question?: string;
  answer?: string;
  order?: number;
  isPublished?: boolean;
}

/**
 * Persistence port for per-product FAQs. Tenant scoping lives at every
 * method signature — no entity carries merchantId directly.
 */
export interface ProductFaqRepositoryPort {
  /** Public storefront view: published only, ordered. */
  findPublishedByProduct(input: {
    productId: string;
  }): Promise<ProductFaqEntity[]>;

  /** Merchant-side: every FAQ for a product within a tenant (any status). */
  listAllForMerchant(input: {
    merchantId: string;
    productId: string;
  }): Promise<ProductFaqEntity[]>;

  create(input: ProductFaqCreateInput, actor: ProductFaqActor): Promise<ProductFaqEntity>;

  update(input: {
    merchantId: string;
    id: string;
    patch: ProductFaqUpdateInput;
  }): Promise<ProductFaqEntity>;

  delete(input: { merchantId: string; id: string }): Promise<void>;

  /**
   * Replace the ordered list for a product. Implementation must be
   * transactional and tenant-scoped.
   */
  reorder(input: {
    merchantId: string;
    productId: string;
    orderedIds: readonly string[];
  }): Promise<ProductFaqEntity[]>;
}
