import { BadRequestException, Body, Controller, Get, HttpCode, Param, Post, Query, Req, UseGuards } from "@nestjs/common";
import { AuthGuard, currentUser } from "../../../auth/presentation/auth.guard.js";
import { PlanLimitGuard, RequirePlanFeature } from "../../../payment/domain/billing-plan-guard.js";
import { StrategyReviewService, type StrategyReviewCommand } from "../../application/strategy-review.service.js";

@Controller("revenue-manager/strategies")
@UseGuards(AuthGuard, PlanLimitGuard)
@RequirePlanFeature("revenueManager")
export class StrategyReviewController {
  constructor(private readonly strategies: StrategyReviewService) {}

  @Get()
  list(@Req() req: any, @Query("after") after?: string) {
    if (after !== undefined && (typeof after !== "string" || after.length > 150)) throw new BadRequestException("STRATEGY_INVALID_CURSOR");
    return this.strategies.list(currentUser(req).merchantId, after);
  }

  @Get(":id")
  read(@Req() req: any, @Param("id") id: string) { return this.strategies.read(currentUser(req).merchantId, id); }

  @Post(":id/approve")
  @HttpCode(200)
  approve(@Req() req: any, @Param("id") id: string, @Body() body: unknown) {
    return this.decide(req, id, "approve", body);
  }

  @Post(":id/reject")
  @HttpCode(200)
  reject(@Req() req: any, @Param("id") id: string, @Body() body: unknown) {
    return this.decide(req, id, "reject", body);
  }

  @Post(":id/revisions")
  @HttpCode(202)
  revise(@Req() req: any, @Param("id") id: string, @Body() body: unknown) {
    return this.decide(req, id, "revision", body);
  }

  private decide(req: any, id: string, kind: "approve" | "reject" | "revision", body: unknown) {
    if (!body || typeof body !== "object" || Array.isArray(body)
      || Object.keys(body).some(key => !["version", "proposal_hash", "request_key", "feedback"].includes(key))) {
      throw new BadRequestException("STRATEGY_INVALID_REVIEW");
    }
    const user = currentUser(req);
    return this.strategies.decide(user.merchantId, user.userId, id, kind, body as StrategyReviewCommand);
  }
}
