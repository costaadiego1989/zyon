import { Injectable, Inject } from "@nestjs/common";
import { STORY_REPOSITORY, type StoryRepositoryPort } from "../../domain/ports/story-repository.port.js";

@Injectable()
export class ArchiveCategoryUseCase {
  constructor(@Inject(STORY_REPOSITORY) private readonly repo: StoryRepositoryPort) {}

  execute(merchantId: string, id: string) {
    return this.repo.archiveCategory(merchantId, id);
  }
}
