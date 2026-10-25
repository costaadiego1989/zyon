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
 * Snapshot of one row from `product_content_history`. The `snapshot` is the
 * JSON-encoded ordered array of `ProductContentBlockProps` that
 * `RevertProductContentUseCase.parseSnapshot` deserializes back into block
 * entities when restoring.
 */
export interface ProductContentHistoryDetail {
  id: string;
  productId: string;
  merchantId: string;
  locale: string;
  version: number;
  savedBy: string;
  restoredFromVersion: number | null;
  savedAt: Date;
  snapshot: { blocks: ProductContentBlockProps[] };
}

/**
 * Summary listing for `listHistoryVersions` — excludes the (potentially
 * large) JSON `snapshot` column to keep the dashboard list cheap.
 */
export interface ProductContentHistorySummary {
  id: string;
  productId: string;
  merchantId: string;
  locale: string;
  version: number;
  savedBy: string;
  restoredFromVersion: number | null;
  savedAt: Date;
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
    locale?: string;
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
   * Implementation is responsible for atomicity within one transaction and
   * MUST snapshot the prior live state into `product_content_history`
   * before the swap (Wave 3 revert contract).
   */
  replaceAll(input: {
    merchantId: string;
    productId: string;
    blocks: readonly ProductContentBlockProps[];
    locale?: string;
    /** Audit actor for the snapshot row — defaults to system when absent. */
    savedBy?: string;
  }): Promise<ProductContentBlockEntity[]>;

  // ── Wave 3 history ──────────────────────────────────────────────────────

  /**
   * Return the most recent history row for a (product, locale) tuple. Used
   * by the dashboard side-panel to show the latest snapshot meta.
   */
  latestHistoryVersion(input: {
    merchantId: string;
    productId: string;
    locale?: string;
  }): Promise<ProductContentHistorySummary | null>;

  /**
   * Return a paginated list of history summaries (no snapshot payload).
   * Ordered by `version DESC`.
   */
  listHistoryVersions(input: {
    merchantId: string;
    productId: string;
    locale?: string;
    limit?: number;
  }): Promise<ProductContentHistorySummary[]>;

  /**
   * Load the full history row including its `snapshot` payload. Used by the
   * revert use-case to deserialize the ordered blocks back.
   */
  findHistoryById(input: {
    merchantId: string;
    productId: string;
    historyId: string;
  }): Promise<ProductContentHistoryDetail | null>;
}
