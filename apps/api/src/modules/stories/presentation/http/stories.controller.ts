import { BadRequestException, Body, Controller, Delete, Get, Inject, Param, Patch, Post, UseGuards } from "@nestjs/common";
import { ApiTags, ApiOperation } from "@nestjs/swagger";
import { CurrentTenant } from "../../../../shared/tenant/current-tenant.decorator.js";
import { AuthGuard } from "../../../auth/presentation/auth.guard.js";
import { PRISMA_CLIENT } from "../../../../shared/persistence/persistence.module.js";
import { PrismaClient } from "@prisma/client";
import { S3UploadService } from "../../../../shared/storage/s3-upload.service.js";
import { ListCategoriesUseCase } from "../../application/use-cases/list-categories.use-case.js";
import { CreateCategoryUseCase } from "../../application/use-cases/create-category.use-case.js";
import { UpdateCategoryUseCase } from "../../application/use-cases/update-category.use-case.js";
import { ArchiveCategoryUseCase } from "../../application/use-cases/archive-category.use-case.js";
import { ReorderCategoriesUseCase } from "../../application/use-cases/reorder-categories.use-case.js";
import { ListStoriesUseCase } from "../../application/use-cases/list-stories.use-case.js";
import { CreateStoryUseCase } from "../../application/use-cases/create-story.use-case.js";
import { UpdateStoryUseCase } from "../../application/use-cases/update-story.use-case.js";
import { ArchiveStoryUseCase } from "../../application/use-cases/archive-story.use-case.js";
import { ReorderStoriesUseCase } from "../../application/use-cases/reorder-stories.use-case.js";
import { ListPublicStoriesUseCase } from "../../application/use-cases/list-public-stories.use-case.js";

@ApiTags("Stories")
@Controller()
export class StoriesController {
  constructor(
    @Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient,
    private readonly s3: S3UploadService,
    private readonly listCategoriesUseCase: ListCategoriesUseCase,
    private readonly createCategoryUseCase: CreateCategoryUseCase,
    private readonly updateCategoryUseCase: UpdateCategoryUseCase,
    private readonly archiveCategoryUseCase: ArchiveCategoryUseCase,
    private readonly reorderCategoriesUseCase: ReorderCategoriesUseCase,
    private readonly listStoriesUseCase: ListStoriesUseCase,
    private readonly createStoryUseCase: CreateStoryUseCase,
    private readonly updateStoryUseCase: UpdateStoryUseCase,
    private readonly archiveStoryUseCase: ArchiveStoryUseCase,
    private readonly reorderStoriesUseCase: ReorderStoriesUseCase,
    private readonly listPublicStoriesUseCase: ListPublicStoriesUseCase,
  ) {}

  // ─── Dashboard: Category Management ─────────────────────────────────────────

  @UseGuards(AuthGuard)
  @ApiOperation({ summary: "List story categories" })
  @Get("story-manager/categories")
  async listCategories(@CurrentTenant() merchantId: string) {
    return this.listCategoriesUseCase.execute(merchantId);
  }

  @UseGuards(AuthGuard)
  @ApiOperation({ summary: "Create story category" })
  @Post("story-manager/categories")
  async createCategory(
    @CurrentTenant() merchantId: string,
    @Body()
    dto: {
      name: string;
      coverImage?: string;
      sortOrder?: number;
    },
  ) {
    return this.createCategoryUseCase.execute(merchantId, dto);
  }

  @UseGuards(AuthGuard)
  @ApiOperation({ summary: "Update story category" })
  @Patch("story-manager/categories/:id")
  async updateCategory(
    @CurrentTenant() merchantId: string,
    @Param("id") id: string,
    @Body()
    dto: Partial<{
      name: string;
      coverImage: string;
      sortOrder: number;
      isArchived: boolean;
    }>,
  ) {
    return this.updateCategoryUseCase.execute(merchantId, id, dto);
  }

  @UseGuards(AuthGuard)
  @ApiOperation({ summary: "Archive story category" })
  @Delete("story-manager/categories/:id")
  async archiveCategory(@CurrentTenant() merchantId: string, @Param("id") id: string) {
    await this.archiveCategoryUseCase.execute(merchantId, id);
    return { success: true };
  }

  @UseGuards(AuthGuard)
  @ApiOperation({ summary: "Reorder story categories" })
  @Post("story-manager/categories/reorder")
  async reorderCategories(
    @CurrentTenant() merchantId: string,
    @Body() dto: { items: { id: string; sortOrder: number }[] },
  ) {
    await this.reorderCategoriesUseCase.execute(merchantId, dto.items);
    return { success: true };
  }

  // ─── Dashboard: Story Management ────────────────────────────────────────────

  @UseGuards(AuthGuard)
  @ApiOperation({ summary: "List stories for category" })
  @Get("story-manager/categories/:categoryId/stories")
  async listStories(@CurrentTenant() merchantId: string, @Param("categoryId") categoryId: string) {
    return this.listStoriesUseCase.execute(categoryId, merchantId);
  }

  @UseGuards(AuthGuard)
  @ApiOperation({ summary: "Create story" })
  @Post("story-manager/categories/:categoryId/stories")
  async createStory(
    @CurrentTenant() merchantId: string,
    @Param("categoryId") categoryId: string,
    @Body()
    dto: {
      imageUrl: string;
      title?: string;
      titleConfig?: any;
      duration?: number;
      sortOrder?: number;
    },
  ) {
    return this.createStoryUseCase.execute(merchantId, categoryId, dto);
  }

  @UseGuards(AuthGuard)
  @ApiOperation({ summary: "Update story" })
  @Patch("story-manager/:id")
  async updateStory(
    @CurrentTenant() merchantId: string,
    @Param("id") id: string,
    @Body()
    dto: Partial<{
      imageUrl: string;
      title: string;
      titleConfig: any;
      duration: number;
      sortOrder: number;
      isArchived: boolean;
    }>,
  ) {
    return this.updateStoryUseCase.execute(merchantId, id, dto);
  }

  @UseGuards(AuthGuard)
  @ApiOperation({ summary: "Archive story" })
  @Delete("story-manager/:id")
  async archiveStory(@CurrentTenant() merchantId: string, @Param("id") id: string) {
    await this.archiveStoryUseCase.execute(merchantId, id);
    return { success: true };
  }

  @UseGuards(AuthGuard)
  @ApiOperation({ summary: "Reorder stories" })
  @Post("story-manager/reorder")
  async reorderStories(
    @CurrentTenant() merchantId: string,
    @Body() dto: { items: { id: string; sortOrder: number }[] },
  ) {
    await this.reorderStoriesUseCase.execute(merchantId, dto.items);
    return { success: true };
  }

  // ─── Upload Image ───────────────────────────────────────────────────────

  @Post("story-manager/upload")
  @UseGuards(AuthGuard)
  async uploadStoryImage(
    @CurrentTenant() merchantId: string,
    @Body() body: { image: string },
  ) {
    if (!body.image) throw new BadRequestException("image_required");
    if (!this.s3.isConfigured()) throw new BadRequestException("s3_not_configured");
    const result = await this.s3.uploadBase64(body.image, `merchants/${merchantId}/stories`);
    return { url: result.url };
  }

  // ─── Public: List Stories ──────────────────────────────────────────────────

  @ApiOperation({ summary: "Get stories for storefront" })
  @Get("stores/:slug/stories")
  async listPublicStories(@Param("slug") slug: string) {
    // Try by ID first, then by slugified name or persisted slug (same logic as get-store-config)
    let merchant = await this.prisma.merchant.findUnique({ where: { id: slug } });

    if (!merchant) {
      const all = await this.prisma.merchant.findMany({ select: { id: true, name: true, storeSettings: true } });
      const match = all.find((m) => {
        const settings = m.storeSettings as { slug?: string } | null;
        if (settings?.slug === slug) return true;
        const slugified = m.name.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
        return slugified === slug;
      });
      if (match) {
        merchant = await this.prisma.merchant.findUnique({ where: { id: match.id } });
      }
    }

    if (!merchant) {
      return { categories: [] };
    }

    return {
      categories: await this.listPublicStoriesUseCase.execute(merchant.id),
    };
  }
}
