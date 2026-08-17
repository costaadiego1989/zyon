import { Controller, ForbiddenException, Get, Param, Query, Req, UseGuards } from "@nestjs/common";
import { AuthGuard, currentUser } from "../../../auth/presentation/auth.guard.js";
import { RequirePlan } from "../../../../shared/guards/require-plan.decorator.js";
import { RequirePlanGuard } from "../../../../shared/guards/require-plan.guard.js";
import { GetDashboardMetricsUseCase, DashboardPeriod } from "../../application/use-cases/get-dashboard-metrics.use-case.js";
import { GetProductPerformanceUseCase } from "../../application/use-cases/get-product-performance.use-case.js";

@UseGuards(AuthGuard, RequirePlanGuard)
@Controller("merchants")
export class AnalyticsController {
  constructor(
    private readonly getDashboard: GetDashboardMetricsUseCase,
    private readonly getProductPerformance: GetProductPerformanceUseCase,
  ) {}

  @Get(":mid/analytics/dashboard")
  @RequirePlan("STORE_ONLY", "BOTH")
  async dashboard(
    @Req() req: any,
    @Param("mid") merchantId: string,
    @Query("period") period?: DashboardPeriod,
  ) {
    this.assertOwnership(req, merchantId);
    return this.getDashboard.execute(merchantId, period ?? "week");
  }

  @Get(":mid/analytics/products")
  @RequirePlan("STORE_ONLY", "BOTH")
  async products(
    @Req() req: any,
    @Param("mid") merchantId: string,
    @Query("month") month?: string,
  ) {
    this.assertOwnership(req, merchantId);
    return this.getProductPerformance.execute(merchantId, month);
  }

  private assertOwnership(req: any, merchantId: string): void {
    const user = currentUser(req);
    if (user.merchantId !== merchantId) {
      throw new ForbiddenException("access_denied");
    }
  }
}
