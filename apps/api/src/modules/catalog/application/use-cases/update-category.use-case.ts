import { Injectable, Inject , Logger} from "@nestjs/common";
import { PrismaClient } from "@prisma/client";
import { PRISMA_CLIENT } from "../../../../shared/persistence/persistence.module.js";
import { CorrelationIdStorage } from "../../../../shared/logger/correlation-id.storage.js";

@Injectable()
export class UpdateCategoryUseCase {
  private readonly logger = new Logger(UpdateCategoryUseCase.name);

  constructor(@Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient) {}

  async execute(
    merchantId: string,
    categoryId: string,
    data: {
      name?: string;
      parentId?: string | null;
      description?: string;
      imageUrl?: string;
      isActive?: boolean;
      sortOrder?: number;
    },
  ) {
    const category = await this.prisma.productCategory.findUnique({
      where: { id: categoryId },
    });

    if (!category || category.merchantId !== merchantId) {
      throw new Error("category_not_found");
    }

    if (data.parentId !== undefined && data.parentId !== null) {
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

    const updateData: Record<string, unknown> = {};
    if (data.name !== undefined) updateData.name = data.name;
    if (data.parentId !== undefined) updateData.parentId = data.parentId;
    if (data.description !== undefined) updateData.description = data.description;
    if (data.imageUrl !== undefined) updateData.imageUrl = data.imageUrl;
    if (data.isActive !== undefined) updateData.isActive = data.isActive;
    if (data.sortOrder !== undefined) updateData.sortOrder = data.sortOrder;

    const updated = await this.prisma.productCategory.update({
      where: { id: categoryId },
      data: updateData,
      select: {
        id: true,
        name: true,
        slug: true,
        parentId: true,
        description: true,
        imageUrl: true,
        isActive: true,
        sortOrder: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    return {
      id: updated.id,
      name: updated.name,
      slug: updated.slug,
      parent_id: updated.parentId ?? null,
      description: updated.description ?? null,
      image_url: updated.imageUrl ?? null,
      is_active: updated.isActive,
      sort_order: updated.sortOrder,
      created_at: updated.createdAt.toISOString(),
      updated_at: updated.updatedAt.toISOString(),
    };
  }
}
