import { Body, Controller, Get, Put, Req, UseGuards, ForbiddenException } from "@nestjs/common";
import { AuthGuard } from "../../../auth/presentation/auth.guard.js";
import { CurrentTenant } from "../../../../shared/tenant/current-tenant.decorator.js";
import { currentTenantPrincipal, type TenantPrincipalRequest } from "../../../../shared/auth/tenant-principal.js";
import { ConfigureServiceBusinessPolicyUseCase } from "../../application/configure-service-business-policy.use-case.js";

export function assertServiceBusinessActor(merchantId: string, request: TenantPrincipalRequest) {
  const actor = currentTenantPrincipal(request);
  if (actor.kind !== "human" || actor.tenantId !== merchantId || !["owner", "admin"].includes(actor.role))
    throw new ForbiddenException("service_business_forbidden");
  return actor;
}

@UseGuards(AuthGuard)
@Controller("merchants/me/service-business-policy")
export class ServiceBusinessPolicyController {
  constructor(private readonly configure: ConfigureServiceBusinessPolicyUseCase) {}

  @Get()
  read(@CurrentTenant() merchantId: string, @Req() request: TenantPrincipalRequest) {
    assertServiceBusinessActor(merchantId, request);
    return this.configure.read(merchantId);
  }

  @Put()
  update(@CurrentTenant() merchantId: string, @Req() request: TenantPrincipalRequest, @Body() body: unknown) {
    const actor = assertServiceBusinessActor(merchantId, request);
    return this.configure.execute(merchantId, actor.userId, body);
  }
}
