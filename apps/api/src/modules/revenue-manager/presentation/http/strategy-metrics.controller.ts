import { BadRequestException, Body, Controller, Get, HttpCode, Param, Post, Query, Req, UseGuards } from "@nestjs/common";
import { AuthGuard, currentUser } from "../../../auth/presentation/auth.guard.js";
import { PlanLimitGuard, RequirePlanFeature } from "../../../payment/domain/billing-plan-guard.js";
import { StrategyMetricsService } from "../../application/strategy-metrics.service.js";

@Controller("revenue-manager/strategies")
@UseGuards(AuthGuard, PlanLimitGuard)
@RequirePlanFeature("revenueManager")
export class StrategyMetricsController {
  constructor(private readonly metrics: StrategyMetricsService) {}

  @Get(":id/metrics")
  read(@Req() req: any, @Param("id") id: string, @Query("version") version: string) {
    if (!/^\d{1,9}$/.test(version ?? "")) throw new BadRequestException("STRATEGY_INVALID_VERSION");
    return this.metrics.read(currentUser(req).merchantId, id, Number(version));
  }

  @Post(":id/metrics")
  @HttpCode(200)
  collect(@Req() req: any, @Param("id") id: string, @Body() body: unknown) {
    if (!body || typeof body !== "object" || Array.isArray(body)
      || Object.keys(body).some(key => key !== "version") || !Number.isSafeInteger((body as any).version)) {
      throw new BadRequestException("STRATEGY_INVALID_METRICS_REQUEST");
    }
    return this.metrics.read(currentUser(req).merchantId, id, (body as { version: number }).version, true);
  }
}
