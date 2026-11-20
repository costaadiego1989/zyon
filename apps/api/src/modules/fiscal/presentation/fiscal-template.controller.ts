import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Put,
  Req,
  UseGuards,
} from "@nestjs/common";
import { AuthGuard } from "../../auth/presentation/auth.guard.js";
import { TenantRoleGuard } from "../../auth/presentation/tenant-role.guard.js";
import { RequireTenantRoles } from "../../auth/presentation/tenant-role.decorator.js";
import type { TenantPrincipalRequest } from "../../../shared/auth/tenant-principal.js";
import { RecoveryTemplateLifecycleUseCase } from "../../whatsapp-templates/application/use-cases/recovery-template-lifecycle.use-case.js";
import { fiscalHttpActor } from "./fiscal-http.js";
@RequireTenantRoles("owner", "admin")
@UseGuards(AuthGuard, TenantRoleGuard)
@Controller("merchants/me/fiscal/templates")
export class FiscalTemplateController {
  constructor(private readonly lifecycle: RecoveryTemplateLifecycleUseCase) {}
  @Get() get(@Req() req: TenantPrincipalRequest) {
    const { principal } = fiscalHttpActor(req, "production");
    return this.lifecycle.get(principal.tenantId, "fiscal_invoice");
  }
  @Put(":channel") save(
    @Req() req: TenantPrincipalRequest,
    @Param("channel") channel: string,
    @Body() body: { body: string; subject?: string; revision?: number }
  ) {
    const { principal } = fiscalHttpActor(req, "production");
    return this.lifecycle.saveChannel(
      principal.tenantId,
      "fiscal_invoice",
      channel,
      { body: body.body, subject: body.subject, revision: body.revision }
    );
  }
  @Post("whatsapp/submit") submit(@Req() req: TenantPrincipalRequest) {
    const { principal } = fiscalHttpActor(req, "production");
    return this.lifecycle.submit(principal.tenantId, "fiscal_invoice");
  }
}
