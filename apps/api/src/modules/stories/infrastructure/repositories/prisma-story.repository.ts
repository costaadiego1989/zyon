import { Injectable, Logger, NotFoundException } from "@nestjs/common";
import { PrismaClient } from "@prisma/client";
import { StoryRepositoryPort } from "../../domain/ports/story-repository.port.js";

@Injectable()
export class PrismaStoryRepository implements StoryRepositoryPort {
  private readonly logger = new Logger(PrismaStoryRepository.name);

  constructor(private readonly prisma: PrismaClient) {}

  async listCategories(merchantId: string): Promise<any[]> {
    return this.prisma.storyCategory.findMany({
      where: {
        merchantId,
        isArchived: false,
      },
      orderBy: {
        sortOrder: "asc",
      },
    });
  }

  async createCategory(merchantId: string, data: { name: string; coverImage?: string; sortOrder?: number }): Promise<any> {
    return this.prisma.storyCategory.create({
      data: {
        merchantId,
        name: data.name,
        coverImage: data.coverImage,
        sortOrder: data.sortOrder ?? 0,
      },
    });
  }

  async updateCategory(
    merchantId: string,
    id: string,
    data: Partial<{ name: string; coverImage: string; sortOrder: number; isArchived: boolean }>,
  ): Promise<any> {
    return this.requireOwned(this.prisma.storyCategory.update({
      where: {
        id,
        merchantId,
      },
      data: {
        ...(data.name !== undefined && { name: data.name }),
        ...(data.coverImage !== undefined && { coverImage: data.coverImage }),
        ...(data.sortOrder !== undefined && { sortOrder: data.sortOrder }),
        ...(data.isArchived !== undefined && { isArchived: data.isArchived }),
      },
    }));
  }

  async archiveCategory(merchantId: string, id: string): Promise<void> {
    await this.requireOwned(this.prisma.storyCategory.update({
      where: { id, merchantId },
      data: { isArchived: true },
    }));
  }

  async reorderCategories(merchantId: string, items: { id: string; sortOrder: number }[]): Promise<void> {
    await this.requireOwned(this.prisma.$transaction(async (tx) => {
      for (const item of items) {
        await tx.storyCategory.update({
          where: { id: item.id, merchantId },
          data: { sortOrder: item.sortOrder },
        });
      }
    }));
  }

  async listStories(categoryId: string, merchantId: string): Promise<any[]> {
    return this.prisma.story.findMany({
      where: {
        categoryId,
        merchantId,
        category: { merchantId },
        isArchived: false,
      },
      orderBy: {
        sortOrder: "asc",
      },
    });
  }

  async createStory(
    merchantId: string,
    categoryId: string,
    data: { imageUrl: string; title?: string; titleConfig?: any; duration?: number; sortOrder?: number },
  ): Promise<any> {
    return this.prisma.$transaction(async (tx) => {
      const category = await tx.storyCategory.findFirst({ where: { id: categoryId, merchantId, isArchived: false } });
      if (!category) throw new NotFoundException("story_category_not_found");
      return tx.story.create({
        data: {
          merchantId,
          category: { connect: { id: categoryId, merchantId, isArchived: false } },
          imageUrl: data.imageUrl,
          title: data.title,
          titleConfig: data.titleConfig,
          duration: data.duration ?? 7,
          sortOrder: data.sortOrder ?? 0,
        },
      });
    });
  }

  async updateStory(
    merchantId: string,
    id: string,
    data: Partial<{ imageUrl: string; title: string; titleConfig: any; duration: number; sortOrder: number; isArchived: boolean }>,
  ): Promise<any> {
    return this.requireOwned(this.prisma.story.update({
      where: { id, merchantId, category: { merchantId } },
      data: {
        ...(data.imageUrl !== undefined && { imageUrl: data.imageUrl }),
        ...(data.title !== undefined && { title: data.title }),
        ...(data.titleConfig !== undefined && { titleConfig: data.titleConfig }),
        ...(data.duration !== undefined && { duration: data.duration }),
        ...(data.sortOrder !== undefined && { sortOrder: data.sortOrder }),
        ...(data.isArchived !== undefined && { isArchived: data.isArchived }),
      },
    }));
  }

  async archiveStory(merchantId: string, id: string): Promise<void> {
    await this.requireOwned(this.prisma.story.update({
      where: { id, merchantId, category: { merchantId } },
      data: { isArchived: true },
    }));
  }

  async reorderStories(merchantId: string, items: { id: string; sortOrder: number }[]): Promise<void> {
    await this.requireOwned(this.prisma.$transaction(async (tx) => {
      for (const item of items) {
        await tx.story.update({
          where: { id: item.id, merchantId, category: { merchantId } },
          data: { sortOrder: item.sortOrder },
        });
      }
    }));
  }

  private async requireOwned<T>(operation: Promise<T>): Promise<T> {
    try {
      return await operation;
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "P2025") {
        throw new NotFoundException("story_resource_not_found");
      }
      throw error;
    }
  }

  async listPublicStories(merchantId: string): Promise<any[]> {
    return this.prisma.storyCategory.findMany({
      where: {
        merchantId,
        isArchived: false,
      },
      include: {
        stories: {
          where: {
            isArchived: false,
            merchantId,
          },
          orderBy: {
            sortOrder: "asc",
          },
        },
      },
      orderBy: {
        sortOrder: "asc",
      },
    });
  }
}
