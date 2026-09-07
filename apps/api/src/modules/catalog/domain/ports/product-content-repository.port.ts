import {
  ProductContentBlockEntity,
  ProductContentBlockProps,
} from "../entities/product-content-block.entity.js";

export const PRODUCT_CONTENT_REPOSITORY = Symbol("ProductContentRepositoryPort");

export interface ProductContentUpsertInput {
  block: ProductContentBlockEntity;
}

export interface ProductContentActor {
  id: string;
  merchantId: string;
}

/**
 * Persistence port for ordered per-product content blocks. Tenant scoping
 * lives at every method signature — no entity carries merchantId.
 */
export interface ProductContentRepositoryPort {
  /**
   * Find all blocks (enabled + disabled) for one product within one
   * merchant's tenancy. Returns entities in ascending `order`.
   */
  findByProduct(input: {
    merchantId: string;
    productId: string;
  }): Promise<ProductContentBlockEntity[]>;

  /**
   * Upsert a single block. `actor.merchantId` MUST equal the product's
   * owning merchantId; the implementation enforces this via the FK join.
   */
  upsert(input: ProductContentUpsertInput, actor: ProductContentActor): Promise<ProductContentBlockEntity>;

  /** Hard delete one block, tenant-scoped. */
  delete(input: {
    merchantId: string;
    productId: string;
    id: string;
  }): Promise<void>;

  /**
   * Replace the entire ordered set of blocks for a product (bulk save path).
   * Implementation is responsible for atomicity within one transaction.
   */
  replaceAll(input: {
    merchantId: string;
    productId: string;
    blocks: readonly ProductContentBlockProps[];
  }): Promise<ProductContentBlockEntity[]>;
}
