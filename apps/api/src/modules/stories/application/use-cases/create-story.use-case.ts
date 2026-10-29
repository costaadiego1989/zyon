import { Injectable, Inject, NotFoundException, Logger } from "@nestjs/common";
import { STORY_REPOSITORY, type StoryRepositoryPort } from "../../domain/ports/story-repository.port.js";

@Injectable()
export class CreateStoryUseCase {
  private readonly logger = new Logger(CreateStoryUseCase.name);

  constructor(
    @Inject(STORY_REPOSITORY) private readonly repo: StoryRepositoryPort,
  ) {}

  async execute(merchantId: string, categoryId: string, data: { imageUrl: string; title?: string; titleConfig?: any; duration?: number; sortOrder?: number }) {
    this.logger.log(`Creating story: merchantId=${merchantId}, categoryId=${categoryId}, imageUrl=${data.imageUrl?.slice(0, 50)}...`);
    try {
      const result = await this.repo.createStory(merchantId, categoryId, data);
      this.logger.log(`Story created: ${result.id}`);
      return result;
    } catch (err: any) {
      this.logger.error(`Create story failed: code=${err?.code} msg=${err?.message?.slice(0, 200)}`);
      if (err?.code === "P2003" || err?.message?.includes("Foreign key constraint")) {
        throw new NotFoundException("story_category_not_found");
      }
      throw err;
    }
  }
}
