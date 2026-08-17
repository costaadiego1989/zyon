import { Injectable, Inject } from "@nestjs/common";
import { STORY_REPOSITORY, type StoryRepositoryPort } from "../../domain/ports/story-repository.port.js";

@Injectable()
export class ListStoriesUseCase {
  constructor(@Inject(STORY_REPOSITORY) private readonly repo: StoryRepositoryPort) {}

  execute(categoryId: string, merchantId: string) {
    return this.repo.listStories(categoryId, merchantId);
  }
}
