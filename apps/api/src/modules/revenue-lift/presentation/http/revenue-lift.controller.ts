import { Controller, Get, Query, Req, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";
import { AuthGuard, currentUser } from "../../../auth/presentation/auth.guard.js";
import { GetRevenueLiftUseCase, GetRevenueLiftTrendUseCase } from "../../application/use-cases/get-revenue-lift.use-case.js";

@ApiTags("Analytics - Revenue Lift")
@Controller("analytics/revenue-lift")
@UseGuards(AuthGuard)
@ApiBearerAuth("JWT")
export class RevenueLiftController {
  constructor(
    private readonly getRevenueLift: GetRevenueLiftUseCase,
    private readonly getRevenueLiftTrend: GetRevenueLiftTrendUseCase,
  ) {}

  @Get()
  @ApiOperation({ summary: "Get current revenue lift calculations" })
  @ApiOkResponse({ description: "Revenue lift summary with cohort metrics and feature breakout" })
  async getSummary(
    @Req() req: any,
    @Query("periodDays") periodDays?: string,
  ) {
    const user = currentUser(req);
    const days = Math.min(Math.max(parseInt(periodDays ?? "30", 10) || 30, 1), 90);
    return this.getRevenueLift.execute(user.merchantId, days);
  }

  @Get("trend")
  @ApiOperation({ summary: "Get daily revenue lift trend" })
  @ApiOkResponse({ description: "Daily lift trend for charting" })
  async getTrend(
    @Req() req: any,
    @Query("days") days?: string,
  ) {
    const user = currentUser(req);
    const d = Math.min(Math.max(parseInt(days ?? "30", 10) || 30, 1), 90);
    return this.getRevenueLiftTrend.execute(user.merchantId, d);
  }
}
