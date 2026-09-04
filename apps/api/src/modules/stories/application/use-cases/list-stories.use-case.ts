import { Injectable, Inject , Logger} from "@nestjs/common";
import { STORY_REPOSITORY, type StoryRepositoryPort } from "../../domain/ports/story-repository.port.js";
import { CorrelationIdStorage } from "../../../../shared/logger/correlation-id.storage.js";

@Injectable()
export class ListStoriesUseCase {
  private readonly logger = new Logger(ListStoriesUseCase.name);

  constructor(@Inject(STORY_REPOSITORY) private readonly repo: StoryRepositoryPort) {}

  execute(categoryId: string, merchantId: string) {
    return this.repo.listStories(categoryId, merchantId);
  }
}
