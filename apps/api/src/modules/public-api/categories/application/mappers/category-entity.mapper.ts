export class CategoryEntityMapper {
  static toResponseList(category: any) {
    return {
      id: category.id,
      name: category.name,
      slug: category.slug ?? null,
      parent_id: category.parent_id ?? category.parentId ?? null,
      is_active: category.is_active ?? category.isActive ?? true,
      sort_order: category.sort_order ?? category.sortOrder ?? 0,
      product_count: category.product_count ?? category.productCount ?? 0,
      created_at: category.created_at ?? category.createdAt ?? null,
      updated_at: category.updated_at ?? category.updatedAt ?? null,
    };
  }

  static toResponseDetail(category: any) {
    return {
      id: category.id,
      name: category.name,
      slug: category.slug ?? null,
      parent_id: category.parent_id ?? category.parentId ?? null,
      description: category.description ?? null,
      image_url: category.image_url ?? category.imageUrl ?? null,
      is_active: category.is_active ?? category.isActive ?? true,
      sort_order: category.sort_order ?? category.sortOrder ?? 0,
      product_count: category.product_count ?? category.productCount ?? 0,
      created_at: category.created_at ?? category.createdAt ?? null,
      updated_at: category.updated_at ?? category.updatedAt ?? null,
    };
  }
}
