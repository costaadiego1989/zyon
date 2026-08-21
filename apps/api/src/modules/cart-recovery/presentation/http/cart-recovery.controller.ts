import {
  Controller,
  Get,
  Inject,
  Query,
  Req,
  UseGuards,
  ValidationPipe,
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
import { GetRecoveryMetricsUseCase } from "../../application/use-cases/get-recovery-metrics.use-case.js";

@ApiTags("Cart Recovery")
@Controller("cart-recovery")
@UseGuards(TenantAccessGuard)
@ApiBearerAuth("JWT")
export class CartRecoveryController {
  constructor(
    private readonly getRecoveryMetrics: GetRecoveryMetricsUseCase,
  ) {}

  @Get("metrics")
  @ApiOperation({ summary: "Get recovery metrics and statistics" })
  @ApiOkResponse({ description: "Recovery metrics retrieved" })
  async getMetrics(
    @Req() req: TenantPrincipalRequest,
    @Query() query?: { daysBack?: number },
  ) {
    const principal = currentTenantPrincipal(req);
    const daysBack = query?.daysBack ?? 30;
    const to = new Date();
    const from = new Date(to.getTime() - daysBack * 24 * 60 * 60 * 1000);
    return this.getRecoveryMetrics.execute({
      merchantId: principal.tenantId,
      from,
      to,
    });
  }

  @Get("attempts")
  @ApiOperation({ summary: "List recovery attempts" })
  @ApiOkResponse({ description: "Recovery attempts retrieved" })
  async listAttempts(
    @Req() req: TenantPrincipalRequest,
    @Query() query?: { status?: string; limit?: number; offset?: number },
  ) {
    const principal = currentTenantPrincipal(req);
    const status = query?.status ?? "all";
    const limit = Math.min(query?.limit ?? 50, 100);
    const offset = query?.offset ?? 0;
    return {
      merchantId: principal.tenantId,
      status,
      limit,
      offset,
      message: "Recovery attempts endpoint",
    };
  }
}
