import { Controller, Get, Header, Param, Query, Req, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";
import { AuthGuard, currentUser } from "../../../auth/presentation/auth.guard.js";
import { RequireTenantRoles } from "../../../auth/presentation/tenant-role.decorator.js";
import { TenantRoleGuard } from "../../../auth/presentation/tenant-role.guard.js";
import {
  FinanceDashboardUseCase,
  type FinancePeriodInput,
  type FinanceTransactionsInput,
} from "../../application/finance-dashboard.use-case.js";
import { GetPaymentAllocationHistoryUseCase } from "../../application/get-payment-allocation-history.use-case.js";

@ApiTags("Dashboard")
@ApiBearerAuth("JWT")
@Controller("dashboard/finance")
@UseGuards(AuthGuard, TenantRoleGuard)
@RequireTenantRoles("owner", "admin")
export class FinanceDashboardController {
  constructor(
    private readonly finance: FinanceDashboardUseCase,
    private readonly paymentAllocationHistoryUseCase: GetPaymentAllocationHistoryUseCase,
  ) {}

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

  @Get("payouts")
  @ApiOperation({ summary: "List delayed merchant payout status" })
  @ApiOkResponse({ description: "Delayed payout holds, submissions and provider-confirmed merchant transfers for the authenticated merchant" })
  async payouts(@Req() req: any) {
    return this.finance.merchantPayouts(currentUser(req).merchantId);
  }

  @Get("export.csv")
  @Header("Content-Type", "text/csv; charset=utf-8")
  @Header("Content-Disposition", 'attachment; filename="financeiro.csv"')
  @ApiOperation({ summary: "Export all filtered merchant financial movements as CSV" })
  async exportCsv(@Req() req: any, @Query() query: FinanceTransactionsInput): Promise<string> {
    return this.finance.exportCsv(currentUser(req).merchantId, query);
  }

  @Get("payment-intents/:paymentIntentId/allocation-history")
  @ApiOperation({
    summary: "Get planned payment allocations and provider observations",
    description: "Administrative trace for one payment intent. It is not a cleared balance, a completed payout, or a complete provider reconciliation.",
  })
  @ApiOkResponse({ description: "Immutable allocation plan and any provider observations visible only to the authenticated merchant" })
  async paymentAllocationHistory(@Req() req: any, @Param("paymentIntentId") paymentIntentId: string) {
    return this.paymentAllocationHistoryUseCase.execute({
      merchantId: currentUser(req).merchantId,
      paymentIntentId,
    });
  }
}
