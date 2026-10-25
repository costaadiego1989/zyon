import { Injectable, Inject , Logger} from "@nestjs/common";
import { STORY_REPOSITORY, type StoryRepositoryPort } from "../../domain/ports/story-repository.port.js";
import { CorrelationIdStorage } from "../../../../shared/logger/correlation-id.storage.js";

@Injectable()
export class ArchiveStoryUseCase {
  private readonly logger = new Logger(ArchiveStoryUseCase.name);

  constructor(@Inject(STORY_REPOSITORY) private readonly repo: StoryRepositoryPort) {}

  execute(merchantId: string, id: string) {
    return this.repo.archiveStory(merchantId, id);
  }
}
