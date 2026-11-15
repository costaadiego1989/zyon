import { Body, Controller, Put, Req, UseGuards } from "@nestjs/common";
import { AuthGuard } from "../../../auth/presentation/auth.guard.js";
import { CurrentTenant } from "../../../../shared/tenant/current-tenant.decorator.js";
import type { TenantPrincipalRequest } from "../../../../shared/auth/tenant-principal.js";
import { ChangeBusinessModeUseCase } from "../../application/change-business-mode.use-case.js";
import { assertServiceBusinessActor } from "./service-business-policy.controller.js";

@UseGuards(AuthGuard)
@Controller("merchants/me/business-mode")
export class BusinessModeController {
  constructor(private readonly changeMode: ChangeBusinessModeUseCase) {}
  @Put()
  update(@CurrentTenant() merchantId: string, @Req() request: TenantPrincipalRequest, @Body() body: unknown) {
    const actor = assertServiceBusinessActor(merchantId, request);
    return this.changeMode.execute(merchantId, actor.userId, body);
  }
}
