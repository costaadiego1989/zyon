import { Injectable, Inject , Logger} from "@nestjs/common";
import { STORY_REPOSITORY, type StoryRepositoryPort } from "../../domain/ports/story-repository.port.js";
import { CorrelationIdStorage } from "../../../../shared/logger/correlation-id.storage.js";

@Injectable()
export class UpdateStoryUseCase {
  private readonly logger = new Logger(UpdateStoryUseCase.name);

  constructor(@Inject(STORY_REPOSITORY) private readonly repo: StoryRepositoryPort) {}

  execute(merchantId: string, id: string, data: Partial<{ imageUrl: string; title: string; titleConfig: any; duration: number; sortOrder: number; isArchived: boolean }>) {
    return this.repo.updateStory(merchantId, id, data);
  }
}
