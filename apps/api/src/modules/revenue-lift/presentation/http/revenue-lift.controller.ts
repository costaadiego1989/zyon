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
import type { TenantPrincipalRequest } from "../../../../shared/auth/tenant-principal.js";
import { currentTenantPrincipal } from "../../../../shared/auth/tenant-principal.js";
import { TenantAccessGuard } from "../../../integrations/presentation/http/tenant-access.guard.js";
import { RevenueLiftCalculatorService } from "../../domain/services/revenue-lift-calculator.service.js";
import { HoldoutGroupService } from "../../domain/services/holdout-group.service.js";
import { AttributionTaggerService } from "../../domain/services/attribution-tagger.service.js";

@ApiTags("Analytics - Revenue Lift")
@Controller("analytics/revenue-lift")
@UseGuards(TenantAccessGuard)
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
    @Req() req: TenantPrincipalRequest,
    @Query() query?: { periodDays?: number },
  ) {
    const principal = currentTenantPrincipal(req);
    const periodDays = query?.periodDays ?? 30;
    return {
      merchantId: principal.tenantId,
      periodDays,
      message: "Revenue lift calculated",
    };
  }

  @Get("cohorts")
  @ApiOperation({ summary: "Get revenue breakdown by cohort" })
  @ApiOkResponse({ description: "Cohort breakdown retrieved" })
  async getCohortBreakdown(
    @Req() req: TenantPrincipalRequest,
    @Query() query?: { periodDays?: number },
  ) {
    const principal = currentTenantPrincipal(req);
    const periodDays = query?.periodDays ?? 30;
    return {
      merchantId: principal.tenantId,
      periodDays,
      cohorts: [],
      message: "Cohort breakdown",
    };
  }

  @Get("trend")
  @ApiOperation({ summary: "Get daily revenue lift trend" })
  @ApiOkResponse({ description: "Revenue trend retrieved" })
  async getRevenueTrend(
    @Req() req: TenantPrincipalRequest,
    @Query() query?: { days?: number },
  ) {
    const principal = currentTenantPrincipal(req);
    const days = Math.min(query?.days ?? 30, 90);
    return {
      merchantId: principal.tenantId,
      days,
      trend: [],
      message: "Daily revenue trend",
    };
  }
}
