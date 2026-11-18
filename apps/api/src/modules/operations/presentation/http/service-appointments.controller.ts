import { BadRequestException, Body, Controller, Param, Post, Req, UseGuards } from "@nestjs/common";
import { AuthGuard } from "../../../auth/presentation/auth.guard.js";
import { MerchantOwnershipGuard } from "../../../auth/presentation/merchant-ownership.guard.js";
import { RequireTenantRoles } from "../../../auth/presentation/tenant-role.decorator.js";
import { currentTenantPrincipal, type TenantPrincipalRequest } from "../../../../shared/auth/tenant-principal.js";
import type { ServiceActor } from "../../../../shared/bookings/service-business-access.js";
import { CreateManualServiceAppointmentUseCase, type ManualServiceAppointmentCommand } from "../../application/create-manual-service-appointment.use-case.js";

import { TransitionServiceAppointmentUseCase, type AttendanceTransitionCommand } from "../../application/transition-service-appointment.use-case.js";

function operator(request: TenantPrincipalRequest): ServiceActor {
  const principal = currentTenantPrincipal(request);
  if (principal.kind !== "human") throw new BadRequestException("human_session_required");
  return { merchantId: principal.tenantId, userId: principal.userId, role: principal.role };
}

@Controller("merchants/:mid/service-appointments")
@UseGuards(AuthGuard, MerchantOwnershipGuard)
export class ServiceAppointmentsController {
  constructor(private readonly manual: CreateManualServiceAppointmentUseCase,
    private readonly attendance: TransitionServiceAppointmentUseCase) {}

  @Post("manual")
  @RequireTenantRoles("owner", "admin")
  createManual(@Req() request: TenantPrincipalRequest, @Body() body: ManualServiceAppointmentCommand) {
    return this.manual.execute(operator(request), body);
  }

  @Post(":appointmentId/transitions")
  @RequireTenantRoles("owner", "admin")
  transition(@Req() request: TenantPrincipalRequest, @Param("appointmentId") appointmentId: string,
    @Body() body: Omit<AttendanceTransitionCommand, "appointmentId">) {
    if (!body || typeof body !== "object" || Array.isArray(body) || Object.hasOwn(body, "appointmentId")) throw new BadRequestException("service_attendance_command_invalid");
    return this.attendance.execute(operator(request), { ...body, appointmentId });
  }
}
