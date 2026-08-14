import { Injectable, Inject, ConflictException } from "@nestjs/common";
import { PrismaClient } from "@prisma/client";
import { PRISMA_CLIENT } from "../../../../shared/persistence/persistence.module.js";

@Injectable()
export class CreateCategoryUseCase {
  constructor(@Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient) {}

  async execute(
    merchantId: string,
    data: {
      name: string;
      slug?: string;
      parentId?: string;
    },
  ) {
    if (!data.name?.trim()) {
      throw new ConflictException("category_name_required");
    }

    // Auto-generate slug if not provided
    const slug = data.slug ?? this.generateSlug(data.name);

    // Check slug uniqueness per merchant
    const existing = await this.prisma.productCategory.findUnique({
      where: { merchantId_slug: { merchantId, slug } },
    });

    if (existing) {
      throw new ConflictException("category_slug_already_exists");
    }

    // If parentId provided, validate it exists
    if (data.parentId) {
      const parent = await this.prisma.productCategory.findUnique({
        where: { id: data.parentId },
      });
      if (!parent || parent.merchantId !== merchantId) {
        throw new ConflictException("parent_category_not_found");
      }
    }

    const category = await this.prisma.productCategory.create({
      data: {
        merchantId,
        name: data.name.trim(),
        slug,
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
      id: category.id,
      name: category.name,
      slug: category.slug,
      parentId: category.parentId ?? undefined,
    };
  }

  private generateSlug(name: string): string {
    return name
      .toLowerCase()
      .trim()
      .replace(/\s+/g, "-")
      .replace(/[^\w-]/g, "");
  }
}
