import { Injectable, Inject } from "@nestjs/common";
import { STORY_REPOSITORY, type StoryRepositoryPort } from "../../domain/ports/story-repository.port.js";

@Injectable()
export class ReorderCategoriesUseCase {
  constructor(@Inject(STORY_REPOSITORY) private readonly repo: StoryRepositoryPort) {}

  execute(merchantId: string, items: { id: string; sortOrder: number }[]) {
    return this.repo.reorderCategories(merchantId, items);
  }
}
