import { Module } from "@nestjs/common";
import type { PrismaClient } from "@prisma/client";
import { PersistenceModule, PRISMA_CLIENT } from "../../shared/persistence/persistence.module.js";
import { StoriesController } from "./presentation/http/stories.controller.js";
import { PrismaStoryRepository } from "./infrastructure/repositories/prisma-story.repository.js";
import { STORY_REPOSITORY } from "./domain/ports/story-repository.port.js";
import { S3UploadService } from "../../shared/storage/s3-upload.service.js";
import { ListCategoriesUseCase } from "./application/use-cases/list-categories.use-case.js";
import { CreateCategoryUseCase } from "./application/use-cases/create-category.use-case.js";
import { UpdateCategoryUseCase } from "./application/use-cases/update-category.use-case.js";
import { ArchiveCategoryUseCase } from "./application/use-cases/archive-category.use-case.js";
import { ReorderCategoriesUseCase } from "./application/use-cases/reorder-categories.use-case.js";
import { ListStoriesUseCase } from "./application/use-cases/list-stories.use-case.js";
import { CreateStoryUseCase } from "./application/use-cases/create-story.use-case.js";
import { UpdateStoryUseCase } from "./application/use-cases/update-story.use-case.js";
import { ArchiveStoryUseCase } from "./application/use-cases/archive-story.use-case.js";
import { ReorderStoriesUseCase } from "./application/use-cases/reorder-stories.use-case.js";
import { ListPublicStoriesUseCase } from "./application/use-cases/list-public-stories.use-case.js";

@Module({
  imports: [PersistenceModule],
  controllers: [StoriesController],
  providers: [
    S3UploadService,
    {
      provide: STORY_REPOSITORY,
      useFactory: (prisma: PrismaClient) => new PrismaStoryRepository(prisma),
      inject: [PRISMA_CLIENT],
    },
    ListCategoriesUseCase,
    CreateCategoryUseCase,
    UpdateCategoryUseCase,
    ArchiveCategoryUseCase,
    ReorderCategoriesUseCase,
    ListStoriesUseCase,
    CreateStoryUseCase,
    UpdateStoryUseCase,
    ArchiveStoryUseCase,
    ReorderStoriesUseCase,
    ListPublicStoriesUseCase,
  ],
  exports: [STORY_REPOSITORY],
})
export class StoriesModule {}
