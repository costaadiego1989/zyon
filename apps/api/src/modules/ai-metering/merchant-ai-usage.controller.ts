import { Controller, Get, Header, Query, Req, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { AuthGuard, currentUser } from "../auth/presentation/auth.guard.js";
import { RequireTenantRoles } from "../auth/presentation/tenant-role.decorator.js";
import { TenantRoleGuard } from "../auth/presentation/tenant-role.guard.js";
import type { FinancePeriodInput } from "../dashboard/application/finance-dashboard.use-case.js";
import { MerchantAiUsageReader } from "./merchant-ai-usage.reader.js";

@ApiTags("Dashboard")
@ApiBearerAuth("JWT")
@Controller("dashboard/finance/ai-usage")
@UseGuards(AuthGuard, TenantRoleGuard)
@RequireTenantRoles("owner", "admin")
export class MerchantAiUsageController {
  constructor(private readonly usage: MerchantAiUsageReader) {}

  @Get()
  @ApiOperation({ summary: "Observed AI usage for the authenticated store, without platform costs or conversation content" })
  report(@Req() req: any, @Query() query: FinancePeriodInput) {
    return this.usage.report(currentUser(req).merchantId, query);
  }

  @Get("export.csv")
  @Header("Content-Type", "text/csv; charset=utf-8")
  @Header("Content-Disposition", 'attachment; filename="consumo-ia.csv"')
  csv(@Req() req: any, @Query() query: FinancePeriodInput) {
    return this.usage.csv(currentUser(req).merchantId, query);
  }
}
