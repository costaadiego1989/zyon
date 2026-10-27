import { Injectable, Logger, Inject } from "@nestjs/common";
import {
  REVIEW_REPOSITORY,
  type ReviewRepositoryPort,
} from "../../domain/ports/review-repository.port.js";
import {
  NPS_REPOSITORY,
  type NpsRepositoryPort,
} from "../../domain/ports/nps-repository.port.js";
import {
  SCHEDULED_MESSAGE_REPOSITORY,
  type ScheduledMessageRepositoryPort,
} from "../../domain/ports/scheduled-message-repository.port.js";

export interface PostSaleStats {
  totalMessagesSent: number;
  totalMessagesScheduled: number;
  totalReviewsReceived: number;
  npsAverage: number | null;
  npsByClassification: {
    promoters: number;
    passives: number;
    detractors: number;
  };
}

@Injectable()
export class GetPostSaleDashboardUseCase {
  private readonly logger = new Logger(GetPostSaleDashboardUseCase.name);

  constructor(
    @Inject(SCHEDULED_MESSAGE_REPOSITORY)
    private readonly messages: ScheduledMessageRepositoryPort,
    @Inject(REVIEW_REPOSITORY)
    private readonly reviews: ReviewRepositoryPort,
    @Inject(NPS_REPOSITORY)
    private readonly nps: NpsRepositoryPort
  ) {}

  async execute(merchantId: string): Promise<PostSaleStats> {
    const [
      sentMessages,
      allMessages,
      reviewCount,
      npsAverage,
      promoters,
      passives,
      detractors,
    ] = await Promise.all([
      this.messages.countByStatus(merchantId, "sent"),
      this.messages.countAll(merchantId),
      this.reviews.countByProduct(merchantId, ""),
      this.nps.averageScore(merchantId),
      this.nps.countByClassification(merchantId, "promoter"),
      this.nps.countByClassification(merchantId, "passive"),
      this.nps.countByClassification(merchantId, "detractor"),
    ]);

    return {
      totalMessagesSent: sentMessages,
      totalMessagesScheduled: allMessages,
      totalReviewsReceived: reviewCount,
      npsAverage,
      npsByClassification: {
        promoters,
        passives,
        detractors,
      },
    };
  }
}
