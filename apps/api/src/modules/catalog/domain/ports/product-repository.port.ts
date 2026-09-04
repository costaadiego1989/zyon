import { ProductEntity, ProductVariantProps } from "../entities/product.entity.js";

export interface CreateProductInput {
  merchantId: string;
  name: string;
  description?: string;
  type?: string;
  metadata?: Record<string, unknown>;
  categoryId?: string;
  seoTitle?: string;
  metaDescription?: string;
  slug?: string;
  ogTitle?: string;
  ogDescription?: string;
  twitterCard?: string;
  keywords?: string[];
  variants: Array<{
    sku: string;
    attributes: Record<string, string>;
    barcode?: string;
    weightGrams?: number;
    lengthCm?: number;
    widthCm?: number;
    heightCm?: number;
    basePriceInCents: number;
    costInCents?: number;
    taxPercent?: number;
    currency?: string;
    stockQuantity?: number;
    media?: Array<{ url: string; type: "IMAGE" | "VIDEO"; alt?: string; order?: number }>;
  }>;
}

export interface SearchProductsInput {
  merchantId: string;
  query?: string;
  categoryId?: string;
  minPriceCents?: number;
  maxPriceCents?: number;
  inStockOnly?: boolean;
  isActiveOnly?: boolean;
  limit?: number;
  cursor?: string;
  offset?: number;
}

export interface SearchProductsResult {
  products: ProductEntity[];
  nextCursor?: string;
  total: number;
}

export interface ReserveStockInput {
  merchantId: string;
  variantId: string;
  quantity: number;
  cartId?: string;
  idempotencyKey: string;
}

export interface ReserveStockResult {
  reservationId: string;
  expiresAt: Date;
}

export interface ProductRepositoryPort {
  create(input: CreateProductInput): Promise<ProductEntity>;
  findById(merchantId: string, productId: string): Promise<ProductEntity | null>;
  search(input: SearchProductsInput): Promise<SearchProductsResult>;
  findExistingVariantSkus(merchantId: string, skus: string[], excludeProductId?: string): Promise<string[]>;
  update(merchantId: string, productId: string, data: Partial<{ name: string; description: string; type: string; metadata: Record<string, unknown>; categoryId: string; isActive: boolean; seoTitle: string; metaDescription: string; slug: string; ogTitle: string; ogDescription: string; twitterCard: string; keywords: string[] }>): Promise<ProductEntity>;
  softDelete(merchantId: string, productId: string): Promise<void>;
  addVariant(merchantId: string, productId: string, variant: CreateProductInput["variants"][0]): Promise<ProductVariantProps>;
  /**
   * List a merchant's product categories as plain {id,name,slug} tuples. Used by
   * the spreadsheet import to resolve category names in the sheet to their
   * canonical ids. Kept here (vs. a separate CategoryRepositoryPort) because
   * categories are conceptually a denormalized view of products.
   */
  listCategories(merchantId: string): Promise<Array<{ id: string; name: string; slug: string; productCount: number }>>;
  /**
   * Update an existing variant (and its owning product's basic fields) matched by
   * SKU, merchant-scoped. Used by idempotent spreadsheet re-imports so re-uploading
   * the same catalog updates price/weight/dimensions/stock/name instead of failing
   * on sku_already_exists. Returns the affected productId, or null when no variant
   * with that SKU exists (caller should then create).
   */
  updateVariantBySku(
    merchantId: string,
    sku: string,
    data: {
      productName?: string;
      description?: string;
      categoryId?: string;
      basePriceInCents?: number;
      weightGrams?: number;
      lengthCm?: number;
      widthCm?: number;
      heightCm?: number;
      stockQuantity?: number;
    },
  ): Promise<{ productId: string } | null>;
}

export interface StockRepositoryPort {
  reserve(input: ReserveStockInput): Promise<ReserveStockResult>;
  confirm(merchantId: string, reservationId: string): Promise<void>;
  releaseExpired(): Promise<number>;
  getAvailableStock(variantId: string): Promise<{ quantity: number; reserved: number }>;
  decrementBySku(merchantId: string, sku: string, quantity: number): Promise<{ ok: boolean; quantity?: number }>;
  getStockBySku(merchantId: string, sku: string): Promise<{ variantId: string; quantity: number; reserved: number } | null>;
  /**
   * Sets catalog stock to an absolute quantity by SKU (merchant-scoped). Used by
   * the reconciliation job to converge catalog stock toward the inventory ledger
   * (source of truth). Returns whether a row was updated.
   */
  setQuantityBySku(merchantId: string, sku: string, quantity: number): Promise<{ ok: boolean }>;
}
