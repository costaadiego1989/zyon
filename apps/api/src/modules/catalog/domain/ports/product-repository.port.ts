import { ProductEntity, ProductVariantProps } from "../entities/product.entity.js";

export interface CreateProductInput {
  merchantId: string;
  name: string;
  description?: string;
  categoryId?: string;
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
  limit?: number;
  cursor?: string;
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
  update(merchantId: string, productId: string, data: Partial<{ name: string; description: string; categoryId: string; isActive: boolean }>): Promise<ProductEntity>;
  softDelete(merchantId: string, productId: string): Promise<void>;
  addVariant(merchantId: string, productId: string, variant: CreateProductInput["variants"][0]): Promise<ProductVariantProps>;
}

export interface StockRepositoryPort {
  reserve(input: ReserveStockInput): Promise<ReserveStockResult>;
  confirm(merchantId: string, reservationId: string): Promise<void>;
  releaseExpired(): Promise<number>;
  getAvailableStock(variantId: string): Promise<{ quantity: number; reserved: number }>;
}
