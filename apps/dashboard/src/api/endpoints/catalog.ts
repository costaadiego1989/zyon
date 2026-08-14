import { dashboardJson } from "../http/client.js";

export interface ProductVariant {
  id: string;
  sku: string;
  attributes: Record<string, string>;
  barcode?: string;
  weightGrams?: number;
  lengthCm?: number;
  widthCm?: number;
  heightCm?: number;
  isActive: boolean;
  basePriceInCents: number;
  costInCents?: number;
  taxPercent: number;
  currency: string;
  stockQuantity: number;
  stockReserved: number;
  media: Array<{ id: string; url: string; type: "IMAGE" | "VIDEO"; alt?: string; order: number }>;
}

export interface Product {
  id: string;
  merchantId: string;
  name: string;
  description?: string;
  categoryId?: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  variants: ProductVariant[];
  averageRating?: number;
  reviewCount?: number;
}

export interface ProductSearchResult {
  products: Product[];
  nextCursor?: string;
  total: number;
}

export interface CreateProductPayload {
  name: string;
  description?: string;
  categoryId?: string;
  variants: Array<{
    sku: string;
    attributes?: Record<string, string>;
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
  }>;
}

export interface UpdateProductPayload {
  name?: string;
  description?: string;
  categoryId?: string;
  isActive?: boolean;
}

export function catalogEndpoints(base: string, f: typeof fetch) {
  return {
    listProducts(
      merchantId: string,
      opts: { query?: string; categoryId?: string; inStockOnly?: boolean; limit?: number; cursor?: string } = {},
    ): Promise<ProductSearchResult> {
      const params = new URLSearchParams();
      if (opts.query) params.set("query", opts.query);
      if (opts.categoryId) params.set("categoryId", opts.categoryId);
      if (opts.inStockOnly) params.set("inStockOnly", "true");
      if (opts.limit) params.set("limit", String(opts.limit));
      if (opts.cursor) params.set("cursor", opts.cursor);
      const qs = params.toString();
      return dashboardJson<ProductSearchResult>(
        base,
        `/merchants/${encodeURIComponent(merchantId)}/products${qs ? `?${qs}` : ""}`,
        { method: "GET" },
        f,
      );
    },
    getProduct(merchantId: string, productId: string): Promise<Product> {
      return dashboardJson<Product>(
        base,
        `/merchants/${encodeURIComponent(merchantId)}/products/${encodeURIComponent(productId)}`,
        { method: "GET" },
        f,
      );
    },
    createProduct(merchantId: string, payload: CreateProductPayload): Promise<Product> {
      return dashboardJson<Product>(
        base,
        `/merchants/${encodeURIComponent(merchantId)}/products`,
        { method: "POST", jsonBody: payload },
        f,
      );
    },
    updateProduct(merchantId: string, productId: string, payload: UpdateProductPayload): Promise<Product> {
      return dashboardJson<Product>(
        base,
        `/merchants/${encodeURIComponent(merchantId)}/products/${encodeURIComponent(productId)}`,
        { method: "PUT", jsonBody: payload },
        f,
      );
    },
    deleteProduct(merchantId: string, productId: string): Promise<{ deleted: boolean }> {
      return dashboardJson<{ deleted: boolean }>(
        base,
        `/merchants/${encodeURIComponent(merchantId)}/products/${encodeURIComponent(productId)}`,
        { method: "DELETE" },
        f,
      );
    },
  };
}