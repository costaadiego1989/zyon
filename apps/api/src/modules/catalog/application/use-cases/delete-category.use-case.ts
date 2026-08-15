import { Injectable, Inject } from "@nestjs/common";
import { PrismaClient } from "@prisma/client";
import { PRISMA_CLIENT } from "../../../../shared/persistence/persistence.module.js";

@Injectable()
export class DeleteCategoryUseCase {
  constructor(@Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient) {}

  async execute(merchantId: string, categoryId: string): Promise<void> {
    const category = await this.prisma.productCategory.findUnique({
      where: { id: categoryId },
    });

    if (!category || category.merchantId !== merchantId) {
      throw new Error("category_not_found");
    }

    await this.prisma.$transaction([
      this.prisma.productCategory.updateMany({
        where: { parentId: categoryId },
        data: { parentId: null },
      }),
      this.prisma.product.updateMany({
        where: { categoryId },
        data: { categoryId: null },
      }),
      this.prisma.productCategory.delete({
        where: { id: categoryId },
      }),
    ]);
  }
}
