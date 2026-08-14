import { Controller, Get, Param, Query, UseGuards } from "@nestjs/common";
import { RequirePlan } from "../../../../shared/guards/require-plan.decorator.js";
import { RequirePlanGuard } from "../../../../shared/guards/require-plan.guard.js";
import { GetDashboardMetricsUseCase, DashboardPeriod } from "../../application/use-cases/get-dashboard-metrics.use-case.js";
import { GetProductPerformanceUseCase } from "../../application/use-cases/get-product-performance.use-case.js";

@UseGuards(RequirePlanGuard)
@Controller("merchants")
export class AnalyticsController {
  constructor(
    private readonly getDashboard: GetDashboardMetricsUseCase,
    private readonly getProductPerformance: GetProductPerformanceUseCase,
  ) {}

  @Get(":mid/analytics/dashboard")
  @RequirePlan("STORE_ONLY", "BOTH")
  async dashboard(
    @Param("mid") merchantId: string,
    @Query("period") period?: DashboardPeriod,
  ) {
    return this.getDashboard.execute(merchantId, period ?? "week");
  }

  @Get(":mid/analytics/products")
  @RequirePlan("STORE_ONLY", "BOTH")
  async products(
    @Param("mid") merchantId: string,
    @Query("month") month?: string,
  ) {
    return this.getProductPerformance.execute(merchantId, month);
  }
}
