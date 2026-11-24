import { BadRequestException, Controller, Get, Header, Param, Req, UseGuards } from "@nestjs/common";
import { AuthGuard } from "../../../auth/presentation/auth.guard.js";
import { MerchantOwnershipGuard } from "../../../auth/presentation/merchant-ownership.guard.js";
import { RequireTenantRoles } from "../../../auth/presentation/tenant-role.decorator.js";
import { currentTenantPrincipal, type TenantPrincipalRequest } from "../../../../shared/auth/tenant-principal.js";
import { ReadServiceAppointmentOperationSummary } from "../../application/read-service-appointment-operation-summary.js";

@Controller("merchants/:mid/service-appointments")
@UseGuards(AuthGuard, MerchantOwnershipGuard)
export class ServiceAppointmentOperationSummaryController {
  constructor(private readonly reader: ReadServiceAppointmentOperationSummary) {}

  @Get(":appointmentId/operation-summary")
  @Header("Cache-Control", "no-store")
  @RequireTenantRoles("owner", "admin")
  summary(@Req() request: TenantPrincipalRequest, @Param("appointmentId") appointmentId: string) {
    const principal = currentTenantPrincipal(request);
    if (principal.kind !== "human") throw new BadRequestException("human_session_required");
    return this.reader.execute({ merchantId: principal.tenantId, userId: principal.userId, role: principal.role }, appointmentId);
  }
}
