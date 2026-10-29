import {
  Controller,
  Post,
  Body,
  BadRequestException,
  Logger,
  HttpCode,
} from "@nestjs/common";
import { SubmitReviewUseCase } from "../../application/use-cases/submit-review.use-case.js";
import { SubmitNpsUseCase } from "../../application/use-cases/submit-nps.use-case.js";

@Controller("post-sale")
export class BuyerPostSaleController {
  private readonly logger = new Logger(BuyerPostSaleController.name);

  constructor(
    private readonly submitReview: SubmitReviewUseCase,
    private readonly submitNps: SubmitNpsUseCase
  ) {}

  @Post("reviews")
  @HttpCode(201)
  async postReview(
    @Body()
    body: {
      merchantId: string;
      productId: string;
      buyerId: string;
      orderId?: string;
      rating: number;
      text?: string;
    }
  ) {
    if (!body.merchantId || !body.productId || !body.buyerId || !body.rating) {
      throw new BadRequestException(
        "Missing required fields: merchantId, productId, buyerId, rating"
      );
    }

    try {
      const result = await this.submitReview.execute(body);
      return {
        success: true,
        reviewId: result.reviewId,
        status: result.status,
      };
    } catch (err) {
      this.logger.error(
        "Failed to submit review",
        { error: err instanceof Error ? err.message : String(err) }
      );
      throw new BadRequestException(
        err instanceof Error ? err.message : "Failed to submit review"
      );
    }
  }

  @Post("nps")
  @HttpCode(201)
  async postNps(
    @Body()
    body: {
      merchantId: string;
      buyerId: string;
      orderId?: string;
      score: number;
      feedback?: string;
    }
  ) {
    if (!body.merchantId || !body.buyerId || body.score === undefined) {
      throw new BadRequestException(
        "Missing required fields: merchantId, buyerId, score"
      );
    }

    try {
      const result = await this.submitNps.execute(body);
      return {
        success: true,
        npsId: result.npsId,
        classification: result.classification,
      };
    } catch (err) {
      this.logger.error(
        "Failed to submit NPS",
        { error: err instanceof Error ? err.message : String(err) }
      );
      throw new BadRequestException(
        err instanceof Error ? err.message : "Failed to submit NPS"
      );
    }
  }
}
