import { BadRequestException, Body, Controller, Post, Req, UseGuards } from "@nestjs/common";
import { AuthGuard } from "../../../auth/presentation/auth.guard.js";
import { MerchantOwnershipGuard } from "../../../auth/presentation/merchant-ownership.guard.js";
import { RequireTenantRoles } from "../../../auth/presentation/tenant-role.decorator.js";
import { currentTenantPrincipal, type TenantPrincipalRequest } from "../../../../shared/auth/tenant-principal.js";
import type { ServiceActor } from "../../../../shared/bookings/service-business-access.js";
import { CreateManualServiceAppointmentUseCase, type ManualServiceAppointmentCommand } from "../../application/create-manual-service-appointment.use-case.js";

function operator(request: TenantPrincipalRequest): ServiceActor {
  const principal = currentTenantPrincipal(request);
  if (principal.kind !== "human") throw new BadRequestException("human_session_required");
  return { merchantId: principal.tenantId, userId: principal.userId, role: principal.role };
}

@Controller("merchants/:mid/service-appointments")
@UseGuards(AuthGuard, MerchantOwnershipGuard)
export class ServiceAppointmentsController {
  constructor(private readonly manual: CreateManualServiceAppointmentUseCase) {}

  @Post("manual")
  @RequireTenantRoles("owner", "admin")
  createManual(@Req() request: TenantPrincipalRequest, @Body() body: ManualServiceAppointmentCommand) {
    return this.manual.execute(operator(request), body);
  }
}
