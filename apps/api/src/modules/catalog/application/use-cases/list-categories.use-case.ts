import { Injectable, Inject } from "@nestjs/common";
import { PrismaClient } from "@prisma/client";
import { PRISMA_CLIENT } from "../../../../shared/persistence/persistence.module.js";

export interface CategoryDTO {
  id: string;
  name: string;
  slug: string;
  parent_id?: string | null;
  description?: string | null;
  image_url?: string | null;
  is_active: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
  product_count: number;
}

@Injectable()
export class ListCategoriesUseCase {
  constructor(@Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient) {}

  async execute(merchantId: string): Promise<CategoryDTO[]> {
    const categories = await this.prisma.productCategory.findMany({
      where: { merchantId },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "desc" }],
      include: {
        _count: {
          select: { products: true },
        },
      },
    });

    return categories.map((c) => ({
      id: c.id,
      name: c.name,
      slug: c.slug,
      parent_id: c.parentId ?? null,
      description: c.description ?? null,
      image_url: c.imageUrl ?? null,
      is_active: c.isActive,
      sort_order: c.sortOrder,
      created_at: c.createdAt.toISOString(),
      updated_at: c.updatedAt.toISOString(),
      product_count: c._count.products,
    }));
  }
}
