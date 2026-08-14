import { Injectable, Inject } from "@nestjs/common";
import { PrismaClient } from "@prisma/client";
import { PRISMA_CLIENT } from "../../../../shared/persistence/persistence.module.js";

@Injectable()
export class UpdateCategoryUseCase {
  constructor(@Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient) {}

  async execute(
    merchantId: string,
    categoryId: string,
    data: {
      name?: string;
      parentId?: string;
    },
  ) {
    // Validate category exists and belongs to merchant
    const category = await this.prisma.productCategory.findUnique({
      where: { id: categoryId },
    });

    if (!category || category.merchantId !== merchantId) {
      throw new Error("category_not_found");
    }

    // If parentId provided, validate it exists and is not self
    if (data.parentId) {
      if (data.parentId === categoryId) {
        throw new Error("category_cannot_be_parent_to_itself");
      }
      const parent = await this.prisma.productCategory.findUnique({
        where: { id: data.parentId },
      });
      if (!parent || parent.merchantId !== merchantId) {
        throw new Error("parent_category_not_found");
      }
    }

    const updated = await this.prisma.productCategory.update({
      where: { id: categoryId },
      data: {
        name: data.name,
        parentId: data.parentId,
      },
      select: {
        id: true,
        name: true,
        slug: true,
        parentId: true,
      },
    });

    return {
      id: updated.id,
      name: updated.name,
      slug: updated.slug,
      parentId: updated.parentId ?? undefined,
    };
  }
}
