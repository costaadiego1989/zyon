import { Injectable, Logger } from "@nestjs/common";
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
    return this.prisma.storyCategory.update({
      where: {
        id,
      },
      data: {
        ...(data.name !== undefined && { name: data.name }),
        ...(data.coverImage !== undefined && { coverImage: data.coverImage }),
        ...(data.sortOrder !== undefined && { sortOrder: data.sortOrder }),
        ...(data.isArchived !== undefined && { isArchived: data.isArchived }),
      },
    });
  }

  async archiveCategory(merchantId: string, id: string): Promise<void> {
    await this.prisma.storyCategory.update({
      where: { id },
      data: { isArchived: true },
    });
  }

  async reorderCategories(merchantId: string, items: { id: string; sortOrder: number }[]): Promise<void> {
    await this.prisma.$transaction(
      items.map((item) =>
        this.prisma.storyCategory.updateMany({
          where: { id: item.id, merchantId },
          data: { sortOrder: item.sortOrder },
        }),
      ),
    );
  }

  async listStories(categoryId: string, merchantId: string): Promise<any[]> {
    return this.prisma.story.findMany({
      where: {
        categoryId,
        merchantId,
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
    return this.prisma.story.create({
      data: {
        merchantId,
        categoryId,
        imageUrl: data.imageUrl,
        title: data.title,
        titleConfig: data.titleConfig,
        duration: data.duration ?? 7,
        sortOrder: data.sortOrder ?? 0,
      },
    });
  }

  async updateStory(
    merchantId: string,
    id: string,
    data: Partial<{ imageUrl: string; title: string; titleConfig: any; duration: number; sortOrder: number; isArchived: boolean }>,
  ): Promise<any> {
    return this.prisma.story.update({
      where: { id },
      data: {
        ...(data.imageUrl !== undefined && { imageUrl: data.imageUrl }),
        ...(data.title !== undefined && { title: data.title }),
        ...(data.titleConfig !== undefined && { titleConfig: data.titleConfig }),
        ...(data.duration !== undefined && { duration: data.duration }),
        ...(data.sortOrder !== undefined && { sortOrder: data.sortOrder }),
        ...(data.isArchived !== undefined && { isArchived: data.isArchived }),
      },
    });
  }

  async archiveStory(merchantId: string, id: string): Promise<void> {
    await this.prisma.story.update({
      where: { id },
      data: { isArchived: true },
    });
  }

  async reorderStories(merchantId: string, items: { id: string; sortOrder: number }[]): Promise<void> {
    await this.prisma.$transaction(
      items.map((item) =>
        this.prisma.story.updateMany({
          where: { id: item.id, merchantId },
          data: { sortOrder: item.sortOrder },
        }),
      ),
    );
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
