import { Injectable, Inject } from "@nestjs/common";
import { PrismaClient } from "@prisma/client";
import { PRISMA_CLIENT } from "../../../../shared/persistence/persistence.module.js";

export interface CategoryDTO {
  id: string;
  name: string;
  slug: string;
  parentId?: string;
}

@Injectable()
export class ListCategoriesUseCase {
  constructor(@Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient) {}

  async execute(merchantId: string): Promise<CategoryDTO[]> {
    const categories = await this.prisma.productCategory.findMany({
      where: { merchantId },
      select: {
        id: true,
        name: true,
        slug: true,
        parentId: true,
      },
      orderBy: { createdAt: "desc" },
    });

    return categories.map((c) => ({
      id: c.id,
      name: c.name,
      slug: c.slug,
      parentId: c.parentId ?? undefined,
    }));
  }
}
