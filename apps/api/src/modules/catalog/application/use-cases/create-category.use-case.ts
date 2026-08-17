import { Injectable, Inject, ConflictException , Logger} from "@nestjs/common";
import { PrismaClient } from "@prisma/client";
import { PRISMA_CLIENT } from "../../../../shared/persistence/persistence.module.js";
import { CorrelationIdStorage } from "../../../../shared/logger/correlation-id.storage.js";

@Injectable()
export class CreateCategoryUseCase {
  private readonly logger = new Logger(CreateCategoryUseCase.name);

  constructor(@Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient) {}

  async execute(
    merchantId: string,
    data: {
      name: string;
      slug?: string;
      parentId?: string;
      description?: string;
      imageUrl?: string;
    },
  ) {
    if (!data.name?.trim()) {
      throw new ConflictException("category_name_required");
    }

    const slug = data.slug ?? this.generateSlug(data.name);

    const existing = await this.prisma.productCategory.findUnique({
      where: { merchantId_slug: { merchantId, slug } },
    });

    if (existing) {
      throw new ConflictException("category_slug_already_exists");
    }

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
        description: data.description,
        imageUrl: data.imageUrl,
      },
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
      id: category.id,
      name: category.name,
      slug: category.slug,
      parent_id: category.parentId ?? null,
      description: category.description ?? null,
      image_url: category.imageUrl ?? null,
      is_active: category.isActive,
      sort_order: category.sortOrder,
      created_at: category.createdAt.toISOString(),
      updated_at: category.updatedAt.toISOString(),
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
