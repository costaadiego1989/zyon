import { Injectable, Inject } from "@nestjs/common";
import { STORY_REPOSITORY, type StoryRepositoryPort } from "../../domain/ports/story-repository.port.js";

@Injectable()
export class CreateCategoryUseCase {
  constructor(@Inject(STORY_REPOSITORY) private readonly repo: StoryRepositoryPort) {}

  execute(merchantId: string, data: { name: string; coverImage?: string; sortOrder?: number }) {
    return this.repo.createCategory(merchantId, data);
  }
}
