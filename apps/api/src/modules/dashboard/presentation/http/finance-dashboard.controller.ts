import { Controller, Get, Header, Query, Req, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";
import { AuthGuard, currentUser } from "../../../auth/presentation/auth.guard.js";
import { RequireTenantRoles } from "../../../auth/presentation/tenant-role.decorator.js";
import { TenantRoleGuard } from "../../../auth/presentation/tenant-role.guard.js";
import {
  FinanceDashboardUseCase,
  type FinancePeriodInput,
  type FinanceTransactionsInput,
} from "../../application/finance-dashboard.use-case.js";

@ApiTags("Dashboard")
@ApiBearerAuth("JWT")
@Controller("dashboard/finance")
@UseGuards(AuthGuard, TenantRoleGuard)
@RequireTenantRoles("owner", "admin")
export class FinanceDashboardController {
  constructor(private readonly finance: FinanceDashboardUseCase) {}

  @Get("summary")
  @ApiOperation({ summary: "Get merchant financial summary" })
  @ApiOkResponse({ description: "Completed-order gross values and provider-confirmed refunds in BRL; not a payout or cleared-balance statement" })
  async summary(@Req() req: any, @Query() query: FinancePeriodInput) {
    return this.finance.summary(currentUser(req).merchantId, query);
  }

  @Get("transactions")
  @ApiOperation({ summary: "List merchant financial movements" })
  @ApiOkResponse({ description: "Server-paginated sales and confirmed refunds" })
  async transactions(@Req() req: any, @Query() query: FinanceTransactionsInput) {
    return this.finance.transactions(currentUser(req).merchantId, query);
  }

  @Get("export.csv")
  @Header("Content-Type", "text/csv; charset=utf-8")
  @Header("Content-Disposition", 'attachment; filename="financeiro.csv"')
  @ApiOperation({ summary: "Export all filtered merchant financial movements as CSV" })
  async exportCsv(@Req() req: any, @Query() query: FinanceTransactionsInput): Promise<string> {
    return this.finance.exportCsv(currentUser(req).merchantId, query);
  }
}
