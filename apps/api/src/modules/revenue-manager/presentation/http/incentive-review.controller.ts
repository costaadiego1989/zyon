import { Body, Controller, Get, HttpCode, Param, Post, Req, UseGuards } from "@nestjs/common";
import { AuthGuard, currentUser } from "../../../auth/presentation/auth.guard.js";
import { PlanLimitGuard, RequirePlanFeature } from "../../../payment/domain/billing-plan-guard.js";
import { IncentiveReviewService, type IncentiveReviewCommand, type IncentiveReviewKind } from "../../application/incentive-review.service.js";

@Controller("revenue-manager/strategies/:id/incentive")
@UseGuards(AuthGuard)
export class IncentiveReviewController {
  constructor(private readonly reviews: IncentiveReviewService) {}
  @Get()
  read(@Req() req: any, @Param("id") id: string) { return this.reviews.read(currentUser(req).merchantId, id); }
  @Post("approve")
  @UseGuards(PlanLimitGuard)
  @RequirePlanFeature("revenueManager")
  @HttpCode(200)
  approve(@Req() req: any, @Param("id") id: string, @Body() body: IncentiveReviewCommand) { return this.decide(req, id, "approve", body); }
  // Refusal and withdrawal remain possible after a plan downgrade or flag stop.
  @Post("reject")
  @HttpCode(200)
  reject(@Req() req: any, @Param("id") id: string, @Body() body: IncentiveReviewCommand) { return this.decide(req, id, "reject", body); }
  @Post("withdraw")
  @HttpCode(200)
  withdraw(@Req() req: any, @Param("id") id: string, @Body() body: IncentiveReviewCommand) { return this.decide(req, id, "withdraw", body); }
  private decide(req: any, id: string, kind: IncentiveReviewKind, body: IncentiveReviewCommand) {
    const user = currentUser(req);
    return this.reviews.decide(user.merchantId, user.userId, id, kind, body);
  }
}
