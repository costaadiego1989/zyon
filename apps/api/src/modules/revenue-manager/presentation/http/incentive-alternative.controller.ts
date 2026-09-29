import { Body, Controller, HttpCode, Param, Post, Req, UseGuards } from "@nestjs/common";
import { AuthGuard, currentUser } from "../../../auth/presentation/auth.guard.js";
import { PlanLimitGuard, RequirePlanFeature } from "../../../payment/domain/billing-plan-guard.js";
import { StrategyReviewService, type IncentiveAlternativeCommand } from "../../application/strategy-review.service.js";

@Controller("revenue-manager/strategies/:id/incentive")
@UseGuards(AuthGuard, PlanLimitGuard)
@RequirePlanFeature("revenueManager")
export class IncentiveAlternativeController {
  constructor(private readonly strategies: StrategyReviewService) {}
  @Post("alternatives")
  @HttpCode(202)
  request(@Req() req: any, @Param("id") id: string, @Body() body: IncentiveAlternativeCommand) {
    const user = currentUser(req);
    return this.strategies.requestIncentiveAlternative(user.merchantId, user.userId, id, body);
  }
}
