import { Controller, ForbiddenException, Get, Param, Query, Req, UseGuards } from "@nestjs/common";
import { AuthGuard, currentUser } from "../../../auth/presentation/auth.guard.js";
import { RequirePlan } from "../../../../shared/guards/require-plan.decorator.js";
import { RequirePlanGuard } from "../../../../shared/guards/require-plan.guard.js";
import { GetDashboardMetricsUseCase, DashboardPeriod } from "../../application/use-cases/get-dashboard-metrics.use-case.js";
import { GetProductPerformanceUseCase } from "../../application/use-cases/get-product-performance.use-case.js";
import { GetProductAnalyticsUseCase } from "../../application/use-cases/get-product-analytics.use-case.js";
import { GetOfferRoiUseCase } from "../../application/use-cases/get-offer-roi.use-case.js";
import { GetPaymentMetricsUseCase } from "../../application/use-cases/get-payment-metrics.use-case.js";
import { GetCustomerMetricsUseCase } from "../../application/use-cases/get-customer-metrics.use-case.js";

@UseGuards(AuthGuard, RequirePlanGuard)
@Controller("merchants")
export class AnalyticsController {
  constructor(
    private readonly getDashboard: GetDashboardMetricsUseCase,
    private readonly getProductPerformance: GetProductPerformanceUseCase,
    private readonly getProductAnalytics: GetProductAnalyticsUseCase,
    private readonly getOfferRoi: GetOfferRoiUseCase,
    private readonly getPaymentMetrics: GetPaymentMetricsUseCase,
    private readonly getCustomerMetrics: GetCustomerMetricsUseCase,
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
    @Query("from") from?: string,
    @Query("to") to?: string,
    @Query("month") month?: string,
  ) {
    this.assertOwnership(req, merchantId);
    // If from/to provided, use enhanced product analytics
    if (from && to) {
      return this.getProductAnalytics.execute(merchantId, new Date(from), new Date(to));
    }
    // Fallback to legacy month-based query
    return this.getProductPerformance.execute(merchantId, month);
  }

  @Get(":mid/analytics/offers")
  @RequirePlan("STORE_ONLY", "BOTH")
  async offers(
    @Req() req: any,
    @Param("mid") merchantId: string,
    @Query("from") from?: string,
    @Query("to") to?: string,
  ) {
    this.assertOwnership(req, merchantId);
    const { fromDate, toDate } = this.resolvePeriod(from, to);
    return this.getOfferRoi.execute(merchantId, fromDate, toDate);
  }

  @Get(":mid/analytics/payments")
  @RequirePlan("STORE_ONLY", "BOTH")
  async payments(
    @Req() req: any,
    @Param("mid") merchantId: string,
    @Query("from") from?: string,
    @Query("to") to?: string,
  ) {
    this.assertOwnership(req, merchantId);
    const { fromDate, toDate } = this.resolvePeriod(from, to);
    return this.getPaymentMetrics.execute(merchantId, fromDate, toDate);
  }

  @Get(":mid/analytics/customers")
  @RequirePlan("STORE_ONLY", "BOTH")
  async customers(
    @Req() req: any,
    @Param("mid") merchantId: string,
    @Query("from") from?: string,
    @Query("to") to?: string,
  ) {
    this.assertOwnership(req, merchantId);
    const { fromDate, toDate } = this.resolvePeriod(from, to);
    return this.getCustomerMetrics.execute(merchantId, fromDate, toDate);
  }

  @Get(":mid/analytics/overview")
  @RequirePlan("STORE_ONLY", "BOTH")
  async overview(
    @Req() req: any,
    @Param("mid") merchantId: string,
    @Query("from") from?: string,
    @Query("to") to?: string,
  ) {
    this.assertOwnership(req, merchantId);
    const { fromDate, toDate } = this.resolvePeriod(from, to);
    const [products, offers, payments, customers] = await Promise.all([
      this.getProductAnalytics.execute(merchantId, fromDate, toDate),
      this.getOfferRoi.execute(merchantId, fromDate, toDate),
      this.getPaymentMetrics.execute(merchantId, fromDate, toDate),
      this.getCustomerMetrics.execute(merchantId, fromDate, toDate),
    ]);
    return { products, offers, payments, customers };
  }

  private assertOwnership(req: any, merchantId: string): void {
    const user = currentUser(req);
    if (user.merchantId !== merchantId) {
      throw new ForbiddenException("access_denied");
    }
  }

  private resolvePeriod(from?: string, to?: string): { fromDate: Date; toDate: Date } {
    const now = new Date();
    const toDate = to ? new Date(to) : now;
    const fromDate = from ? new Date(from) : new Date(now.getFullYear(), now.getMonth(), now.getDate() - 30);
    return { fromDate, toDate };
  }
}
