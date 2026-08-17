import { Injectable, Inject } from "@nestjs/common";
import { STORY_REPOSITORY, type StoryRepositoryPort } from "../../domain/ports/story-repository.port.js";

@Injectable()
export class UpdateStoryUseCase {
  constructor(@Inject(STORY_REPOSITORY) private readonly repo: StoryRepositoryPort) {}

  execute(merchantId: string, id: string, data: Partial<{ imageUrl: string; title: string; titleConfig: any; duration: number; sortOrder: number; isArchived: boolean }>) {
    return this.repo.updateStory(merchantId, id, data);
  }
}
