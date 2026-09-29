import { BadRequestException, Controller, Get, Param, Query, Req, UseGuards } from "@nestjs/common";
import { AuthGuard, currentUser } from "../../../auth/presentation/auth.guard.js";
import { PlanLimitGuard, RequirePlanFeature } from "../../../payment/domain/billing-plan-guard.js";
import { IncentiveMetricsService } from "../../application/incentive-metrics.service.js";

@Controller("revenue-manager/strategies/:id/incentive/metrics")
@UseGuards(AuthGuard, PlanLimitGuard)
@RequirePlanFeature("revenueManager")
export class IncentiveMetricsController {
  constructor(private readonly metrics: IncentiveMetricsService) {}
  @Get()
  read(@Req() req: any, @Param("id") id: string, @Query("version") version: string) {
    if (!/^\d{1,9}$/.test(version ?? "")) throw new BadRequestException("INCENTIVE_INVALID_VERSION");
    return this.metrics.read(currentUser(req).merchantId, id, Number(version));
  }
}
