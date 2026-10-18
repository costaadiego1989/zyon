import { Body, Controller, Get, HttpException, Inject, Param, Patch, Post, Query, Req, UseFilters, UseGuards, Catch, type ExceptionFilter, type ArgumentsHost } from "@nestjs/common";
import { currentTenantPrincipal, type TenantPrincipalRequest } from "../../../shared/auth/tenant-principal.js";
import { AuthGuard } from "../../auth/presentation/auth.guard.js";
import { RequireTenantRoles } from "../../auth/presentation/tenant-role.decorator.js";
import { PlatformAccessGuard } from "../../platform-control/presentation/platform-access.guard.js";
import { PlatformPermissionGuard } from "../../platform-control/presentation/platform-permission.guard.js";
import { RequirePlatformPermissions } from "../../platform-control/presentation/platform-permission.decorator.js";
import { currentPlatformPrincipal, type PlatformPrincipalRequest } from "../../platform-control/presentation/platform-principal.js";
import { PlatformSupportService } from "../application/platform-support.service.js";
import { SupportError, type SupportActor } from "../domain/platform-support.js";

@Catch(SupportError)
export class PlatformSupportErrorFilter implements ExceptionFilter {
  catch(error: SupportError, host: ArgumentsHost) {
    host.switchToHttp().getResponse().status(error.status).json({ statusCode: error.status, code: error.code, message: error.code });
  }
}

function merchantActor(request: TenantPrincipalRequest): SupportActor {
  const principal = currentTenantPrincipal(request);
  if (principal.kind !== "human") throw new HttpException("support_human_required", 403);
  return { kind: "merchant", id: principal.userId, merchantId: principal.tenantId };
}

function operatorActor(request: PlatformPrincipalRequest): SupportActor {
  const principal = currentPlatformPrincipal(request);
  return { kind: "operator", id: principal.operatorId, canAssign: principal.role === "platform_admin" };
}

/** Explicit field allowlists apply equally to HTTP commands and socket commands. */
export function supportBody(data: unknown, allowed: string[]): Record<string, unknown> {
  if (!data || typeof data !== "object" || Array.isArray(data) || Object.keys(data).some(key => !allowed.includes(key))) throw new SupportError("support_invalid_body");
  return data as Record<string, unknown>;
}

@Controller("merchants/me/platform-support")
@UseGuards(AuthGuard)
@RequireTenantRoles("owner", "admin", "staff")
@UseFilters(PlatformSupportErrorFilter)
export class MerchantPlatformSupportController {
  constructor(@Inject(PlatformSupportService) private readonly support: PlatformSupportService) {}
  @Get("capabilities") capabilities(@Req() req: TenantPrincipalRequest) { const actor = merchantActor(req); return this.support.capabilities((actor as Extract<SupportActor, { kind: "merchant" }>).merchantId); }
  @Get() list(@Req() req: TenantPrincipalRequest, @Query() query: Record<string, unknown>) { return this.support.list(merchantActor(req), query); }
  @Post() create(@Req() req: TenantPrincipalRequest, @Body() body: unknown) { return this.support.create(merchantActor(req), supportBody(body, ["subject", "category", "content", "clientRequestId"])); }
  @Get(":id") conversation(@Req() req: TenantPrincipalRequest, @Param("id") id: string, @Query("before") before?: string) { return this.support.conversation(merchantActor(req), id, before); }
  @Post(":id/messages") send(@Req() req: TenantPrincipalRequest, @Param("id") id: string, @Body() body: unknown) { return this.support.send(merchantActor(req), id, supportBody(body, ["content", "clientMessageId"])); }
  @Post(":id/read") read(@Req() req: TenantPrincipalRequest, @Param("id") id: string, @Body() body: unknown) { return this.support.read(merchantActor(req), id, supportBody(body, ["sequence"]).sequence); }
  @Post(":id/reopen") reopen(@Req() req: TenantPrincipalRequest, @Param("id") id: string) { return this.support.reopen(merchantActor(req), id); }
}

@Controller("platform/support")
@UseGuards(PlatformAccessGuard, PlatformPermissionGuard)
@RequirePlatformPermissions("platform:support:read")
@UseFilters(PlatformSupportErrorFilter)
export class OperatorPlatformSupportController {
  constructor(@Inject(PlatformSupportService) private readonly support: PlatformSupportService) {}
  @Get() list(@Req() req: PlatformPrincipalRequest, @Query() query: Record<string, unknown>) { return this.support.list(operatorActor(req), query); }
  @Get(":id") conversation(@Req() req: PlatformPrincipalRequest, @Param("id") id: string, @Query("before") before?: string) { return this.support.conversation(operatorActor(req), id, before); }
  @Post(":id/messages") @RequirePlatformPermissions("platform:support:write") send(@Req() req: PlatformPrincipalRequest, @Param("id") id: string, @Body() body: unknown) { return this.support.send(operatorActor(req), id, supportBody(body, ["content", "clientMessageId"])); }
  @Post(":id/read") read(@Req() req: PlatformPrincipalRequest, @Param("id") id: string, @Body() body: unknown) { return this.support.read(operatorActor(req), id, supportBody(body, ["sequence"]).sequence); }
  @Post(":id/reopen") @RequirePlatformPermissions("platform:support:write") reopen(@Req() req: PlatformPrincipalRequest, @Param("id") id: string) { return this.support.reopen(operatorActor(req), id); }
  @Patch(":id") @RequirePlatformPermissions("platform:support:write") treat(@Req() req: PlatformPrincipalRequest, @Param("id") id: string, @Body() body: unknown) { return this.support.treat(operatorActor(req), id, supportBody(body, ["status", "severity", "assignedOperatorId"])); }
  @Get(":id/notes") notes(@Req() req: PlatformPrincipalRequest, @Param("id") id: string) { return this.support.notes(operatorActor(req), id); }
  @Post(":id/notes") @RequirePlatformPermissions("platform:support:write") addNote(@Req() req: PlatformPrincipalRequest, @Param("id") id: string, @Body() body: unknown) { return this.support.addNote(operatorActor(req), id, supportBody(body, ["content", "clientRequestId"])); }
}
