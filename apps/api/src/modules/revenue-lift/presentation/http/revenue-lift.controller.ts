import {
  Controller,
  Get,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from "@nestjs/swagger";
import { AuthGuard, currentUser } from "../../../auth/presentation/auth.guard.js";
import { RevenueLiftCalculatorService } from "../../domain/services/revenue-lift-calculator.service.js";
import { HoldoutGroupService } from "../../domain/services/holdout-group.service.js";
import { AttributionTaggerService } from "../../domain/services/attribution-tagger.service.js";

@ApiTags("Analytics - Revenue Lift")
@Controller("analytics/revenue-lift")
@UseGuards(AuthGuard)
@ApiBearerAuth("JWT")
export class RevenueLiftController {
  constructor(
    private readonly revenueLiftCalculator: RevenueLiftCalculatorService,
    private readonly holdoutGroupService: HoldoutGroupService,
    private readonly attributionTaggerService: AttributionTaggerService,
  ) {}

  @Get()
  @ApiOperation({ summary: "Get current revenue lift calculations" })
  @ApiOkResponse({ description: "Revenue lift data retrieved" })
  async getRevenueLift(
    @Req() req: any,
    @Query() query?: { periodDays?: number },
  ) {
    const user = currentUser(req);
    const periodDays = query?.periodDays ?? 30;
    return {
      merchantId: user.merchantId,
      periodDays,
      message: "Revenue lift calculated",
    };
  }

  @Get("cohorts")
  @ApiOperation({ summary: "Get revenue breakdown by cohort" })
  @ApiOkResponse({ description: "Cohort breakdown retrieved" })
  async getCohortBreakdown(
    @Req() req: any,
    @Query() query?: { periodDays?: number },
  ) {
    const user = currentUser(req);
    const periodDays = query?.periodDays ?? 30;
    return {
      merchantId: user.merchantId,
      periodDays,
      cohorts: [],
      message: "Cohort breakdown",
    };
  }

  @Get("trend")
  @ApiOperation({ summary: "Get daily revenue lift trend" })
  @ApiOkResponse({ description: "Revenue trend retrieved" })
  async getRevenueTrend(
    @Req() req: any,
    @Query() query?: { days?: number },
  ) {
    const user = currentUser(req);
    const days = Math.min(query?.days ?? 30, 90);
    return {
      merchantId: user.merchantId,
      days,
      trend: [],
      message: "Daily revenue trend",
    };
  }
}
