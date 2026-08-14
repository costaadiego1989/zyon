import { Injectable, Inject } from "@nestjs/common";
import { PrismaClient } from "@prisma/client";
import { PRISMA_CLIENT } from "../../../../shared/persistence/persistence.module.js";

@Injectable()
export class DeleteCategoryUseCase {
  constructor(@Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient) {}

  async execute(merchantId: string, categoryId: string): Promise<void> {
    // Validate category exists and belongs to merchant
    const category = await this.prisma.productCategory.findUnique({
      where: { id: categoryId },
    });

    if (!category || category.merchantId !== merchantId) {
      throw new Error("category_not_found");
    }

    // Check if category has children (prevent deletion if it does)
    const childCount = await this.prisma.productCategory.count({
      where: { parentId: categoryId },
    });

    if (childCount > 0) {
      throw new Error("category_has_children");
    }

    // Delete category
    await this.prisma.productCategory.delete({
      where: { id: categoryId },
    });
  }
}
