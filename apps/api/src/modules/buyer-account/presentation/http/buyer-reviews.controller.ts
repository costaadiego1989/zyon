import { Controller, Get, Req, UseGuards } from "@nestjs/common";
import { ListBuyerReviewsUseCase } from "../../application/use-cases/list-buyer-reviews.use-case.js";
import { BuyerJwtAuthGuard, currentBuyer } from "./buyer-jwt-auth.guard.js";

@Controller("buyer/me/reviews")
@UseGuards(BuyerJwtAuthGuard)
export class BuyerReviewsController {
  constructor(private readonly listReviews: ListBuyerReviewsUseCase) {}

  @Get()
  async list(@Req() req: { user?: unknown }) {
    const buyer = currentBuyer(req);
    const items = await this.listReviews.execute(buyer.globalUserId);
    return {
      items: items.map((r) => ({
        id: r.id,
        product_name: r.productName,
        rating: r.rating,
        body: r.body,
        status: r.status,
        created_at: r.createdAt.toISOString(),
      })),
    };
  }
}
