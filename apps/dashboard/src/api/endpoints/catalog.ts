import { dashboardJson } from "../http/client.js";

export interface ProductCategoryDTO {
  id: string;
  merchant_id: string;
  name: string;
  slug: string;
  parent_id: string | null;
  description: string | null;
  image_url: string | null;
  is_active: boolean;
  sort_order: number;
  product_count: number;
  created_at: string;
  updated_at: string;
}

export interface CreateCategoryInput {
  name: string;
  slug?: string;
  parent_id?: string;
  description?: string;
  image_url?: string;
}

export interface UpdateCategoryInput {
  name?: string;
  parent_id?: string | null;
  description?: string;
  image_url?: string;
  is_active?: boolean;
  sort_order?: number;
}

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
  type?: string;
  metadata?: Record<string, unknown>;
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
  type?: string;
  metadata?: Record<string, unknown>;
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
  type?: string;
  metadata?: Record<string, unknown>;
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
    updateVariant(merchantId: string, productId: string, variantId: string, data: { basePriceInCents?: number; costInCents?: number | null; stockQuantity?: number; weightGrams?: number | null; lengthCm?: number | null; widthCm?: number | null; heightCm?: number | null }): Promise<unknown> {
      return dashboardJson(
        base,
        `/merchants/${encodeURIComponent(merchantId)}/products/${encodeURIComponent(productId)}/variants/${encodeURIComponent(variantId)}`,
        { method: "PUT", jsonBody: data },
        f,
      );
    },
    uploadProductMedia(merchantId: string, variantId: string, imageBase64: string): Promise<{ id: string; url: string }> {
      return dashboardJson<{ id: string; url: string }>(
        base,
        `/merchants/${encodeURIComponent(merchantId)}/products/media`,
        { method: "POST", jsonBody: { variantId, image: imageBase64 } },
        f,
      );
    },
    deleteProductMedia(merchantId: string, mediaId: string): Promise<{ deleted: boolean }> {
      return dashboardJson<{ deleted: boolean }>(
        base,
        `/merchants/${encodeURIComponent(merchantId)}/products/media/${encodeURIComponent(mediaId)}`,
        { method: "DELETE" },
        f,
      );
    },
    listCategories(merchantId: string): Promise<ProductCategoryDTO[]> {
      return dashboardJson<ProductCategoryDTO[]>(
        base,
        `/merchants/${encodeURIComponent(merchantId)}/categories`,
        { method: "GET" },
        f,
      );
    },
    createCategory(merchantId: string, data: CreateCategoryInput): Promise<ProductCategoryDTO> {
      return dashboardJson<ProductCategoryDTO>(
        base,
        `/merchants/${encodeURIComponent(merchantId)}/categories`,
        { method: "POST", jsonBody: data },
        f,
      );
    },
    updateCategory(merchantId: string, id: string, data: UpdateCategoryInput): Promise<ProductCategoryDTO> {
      return dashboardJson<ProductCategoryDTO>(
        base,
        `/merchants/${encodeURIComponent(merchantId)}/categories/${encodeURIComponent(id)}`,
        { method: "PUT", jsonBody: data },
        f,
      );
    },
    deleteCategory(merchantId: string, id: string): Promise<void> {
      return dashboardJson<void>(
        base,
        `/merchants/${encodeURIComponent(merchantId)}/categories/${encodeURIComponent(id)}`,
        { method: "DELETE" },
        f,
      );
    },
    reorderCategories(merchantId: string, items: Array<{ id: string; sort_order: number }>): Promise<void> {
      return dashboardJson<void>(
        base,
        `/merchants/${encodeURIComponent(merchantId)}/categories/reorder`,
        { method: "PATCH", jsonBody: { items } },
        f,
      );
    },
  };
}