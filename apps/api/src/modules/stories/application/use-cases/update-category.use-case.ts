import { Injectable, Inject } from "@nestjs/common";
import { STORY_REPOSITORY, type StoryRepositoryPort } from "../../domain/ports/story-repository.port.js";

@Injectable()
export class UpdateCategoryUseCase {
  constructor(@Inject(STORY_REPOSITORY) private readonly repo: StoryRepositoryPort) {}

  execute(merchantId: string, id: string, data: Partial<{ name: string; coverImage: string; sortOrder: number; isArchived: boolean }>) {
    return this.repo.updateCategory(merchantId, id, data);
  }
}
