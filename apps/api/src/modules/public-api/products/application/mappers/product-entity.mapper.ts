/**
 * Pure mapper functions: catalog domain → v1 API response shape.
 * No side effects, no business logic.
 */
export class ProductEntityMapper {
  /**
   * ProductEntity → v1 list item (summary)
   */
  static toProductSummaryResponse(product: any) {
    return {
      id: product.id,
      merchant_id: product.merchantId,
      name: product.name,
      slug: product.slug ?? null,
      type: product.type ?? null,
      category_id: product.categoryId ?? null,
      is_active: product.isActive ?? true,
      variants_count: product.variants?.length ?? 0,
      created_at: product.createdAt?.toISOString?.() ?? product.createdAt ?? null,
      updated_at: product.updatedAt?.toISOString?.() ?? product.updatedAt ?? null,
    };
  }

  /**
   * ProductEntity → v1 full detail
   */
  static toProductDetailResponse(product: any) {
    return {
      ...ProductEntityMapper.toProductSummaryResponse(product),
      description: product.description ?? null,
      metadata: product.metadata ?? {},
      seo: {
        title: product.seoTitle ?? null,
        meta_description: product.metaDescription ?? null,
        slug: product.slug ?? null,
        og_title: product.ogTitle ?? null,
        og_description: product.ogDescription ?? null,
        keywords: product.keywords ?? [],
      },
      variants: (product.variants ?? []).map((v: any) => ({
        id: v.id,
        sku: v.sku,
        attributes: v.attributes ?? {},
        base_price_minor: v.basePriceInCents ?? null,
        cost_minor: v.costInCents ?? null,
        currency: v.currency ?? 'BRL',
        stock_quantity: v.stockQuantity ?? 0,
        stock_reserved: v.stockReserved ?? 0,
        is_active: v.isActive ?? true,
      })),
    };
  }
}
