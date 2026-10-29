import { Injectable, Inject , Logger} from "@nestjs/common";
import { STORY_REPOSITORY, type StoryRepositoryPort } from "../../domain/ports/story-repository.port.js";
import { CorrelationIdStorage } from "../../../../shared/logger/correlation-id.storage.js";

@Injectable()
export class ReorderStoriesUseCase {
  private readonly logger = new Logger(ReorderStoriesUseCase.name);

  constructor(@Inject(STORY_REPOSITORY) private readonly repo: StoryRepositoryPort) {}

  execute(merchantId: string, items: { id: string; sortOrder: number }[]) {
    return this.repo.reorderStories(merchantId, items);
  }
}
