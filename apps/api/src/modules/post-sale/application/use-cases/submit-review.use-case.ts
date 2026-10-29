import { Injectable, Logger, Inject } from "@nestjs/common";
import {
  REVIEW_REPOSITORY,
  type ReviewRepositoryPort,
} from "../../domain/ports/review-repository.port.js";
import { DOMAIN_EVENT_BUS, type DomainEventBus } from "../../../../shared/events/domain-event-bus.port.js";

export interface SubmitReviewInput {
  merchantId: string;
  productId: string;
  buyerId: string;
  orderId?: string;
  rating: number;
  text?: string;
}

@Injectable()
export class SubmitReviewUseCase {
  private readonly logger = new Logger(SubmitReviewUseCase.name);

  constructor(
    @Inject(REVIEW_REPOSITORY)
    private readonly reviews: ReviewRepositoryPort,
    @Inject(DOMAIN_EVENT_BUS)
    private readonly eventBus: DomainEventBus
  ) {}

  async execute(input: SubmitReviewInput) {
    // Validate rating
    if (input.rating < 1 || input.rating > 5) {
      throw new Error("Rating must be between 1 and 5");
    }

    // Auto-approve if rating >= 4, otherwise pending
    const moderationStatus = input.rating >= 4 ? "approved" : "pending";

    const review = await this.reviews.create({
      merchantId: input.merchantId,
      productId: input.productId,
      buyerId: input.buyerId,
      orderId: input.orderId,
      rating: input.rating,
      text: input.text,
      verified: true,
    });

    // If auto-approved, update status
    if (moderationStatus === "approved") {
      await this.reviews.update(review.id, {
        moderationStatus: "approved",
      });
    }

    // Publish event
    await this.eventBus.publish({
      eventType: "post_sale:review_submitted",
      merchantId: input.merchantId,
      payload: {
        type: "post_sale:review_submitted",
        merchantId: input.merchantId,
        reviewId: review.id,
        productId: input.productId,
        buyerId: input.buyerId,
        rating: input.rating,
      },
    });

    this.logger.log(
      `Review submitted`,
      {
        reviewId: review.id,
        productId: input.productId,
        buyerId: input.buyerId,
        rating: input.rating,
        merchantId: input.merchantId,
      }
    );

    return {
      reviewId: review.id,
      status: moderationStatus,
    };
  }
}
