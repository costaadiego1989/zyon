import { Controller, Get, Query, Req, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { ListPlatformAuditEventsUseCase } from "../application/list-platform-audit-events.use-case.js";
import { PlatformAccessGuard } from "./platform-access.guard.js";
import { throwPlatformAuditHttpError } from "./platform-audit.http-errors.js";
import { PlatformPermissionGuard } from "./platform-permission.guard.js";
import { RequirePlatformPermissions } from "./platform-permission.decorator.js";
import { currentPlatformPrincipal, type PlatformPrincipalRequest } from "./platform-principal.js";

@ApiTags("Platform Control Audit")
@ApiBearerAuth("PlatformOperatorJWT")
@UseGuards(PlatformAccessGuard, PlatformPermissionGuard)
@Controller("platform/audit")
export class PlatformAuditController {
  constructor(private readonly auditEvents: ListPlatformAuditEventsUseCase) {}

  @Get()
  @RequirePlatformPermissions("platform:audit:read")
  @ApiOperation({ summary: "List permissioned platform-control audit events" })
  async list(
    @Query() query: {
      cursor?: unknown;
      limit?: unknown;
      action?: unknown;
      actor_operator_id?: unknown;
      from?: unknown;
      to?: unknown;
    },
    @Req() request: PlatformPrincipalRequest & { correlationId?: string },
  ) {
    try {
      const principal = currentPlatformPrincipal(request);
      return await this.auditEvents.execute(query, {
        actorOperatorId: principal.operatorId,
        correlationId: request.correlationId ?? crypto.randomUUID(),
        environment: process.env.APP_ENV ?? process.env.NODE_ENV ?? "unknown",
      });
    } catch (error) {
      throwPlatformAuditHttpError(error);
    }
  }
}
