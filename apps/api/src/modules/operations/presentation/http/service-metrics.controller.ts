import { BadRequestException, Controller, Get, Header, Query, Req, UseGuards } from "@nestjs/common";
import { AuthGuard } from "../../../auth/presentation/auth.guard.js";
import { MerchantOwnershipGuard } from "../../../auth/presentation/merchant-ownership.guard.js";
import { RequireTenantRoles } from "../../../auth/presentation/tenant-role.decorator.js";
import { currentTenantPrincipal, type TenantPrincipalRequest } from "../../../../shared/auth/tenant-principal.js";
import { ReadServiceMetricsUseCase } from "../../application/read-service-metrics.use-case.js";

@Controller("merchants/:mid/service-metrics")
@UseGuards(AuthGuard, MerchantOwnershipGuard)
export class ServiceMetricsController {
  constructor(private readonly metrics: ReadServiceMetricsUseCase) {}

  @Get()
  @Header("Cache-Control", "no-store")
  @RequireTenantRoles("owner", "admin")
  async read(@Req() request: TenantPrincipalRequest, @Query() query: Record<string, unknown>) {
    const principal = currentTenantPrincipal(request);
    if (principal.kind !== "human") throw new BadRequestException("human_session_required");
    return this.metrics.execute({ merchantId: principal.tenantId, userId: principal.userId, role: principal.role }, query);
  }
}
