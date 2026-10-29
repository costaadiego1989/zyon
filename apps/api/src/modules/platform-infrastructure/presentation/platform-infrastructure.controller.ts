import { Controller, Get, Req, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { GetPlatformInfrastructureReadinessUseCase } from "../application/get-platform-infrastructure-readiness.use-case.js";
import { PlatformAccessGuard } from "../../platform-control/presentation/platform-access.guard.js";
import { PlatformPermissionGuard } from "../../platform-control/presentation/platform-permission.guard.js";
import { RequirePlatformPermissions } from "../../platform-control/presentation/platform-permission.decorator.js";
import { currentPlatformPrincipal, type PlatformPrincipalRequest } from "../../platform-control/presentation/platform-principal.js";

@ApiTags("Platform Control Infrastructure")
@ApiBearerAuth("PlatformOperatorJWT")
@UseGuards(PlatformAccessGuard, PlatformPermissionGuard)
@Controller("platform/infrastructure")
export class PlatformInfrastructureController {
  constructor(private readonly readiness: GetPlatformInfrastructureReadinessUseCase) {}

  @Get("readiness")
  @RequirePlatformPermissions("platform:infrastructure:read")
  @ApiOperation({ summary: "Read direct database and Redis readiness probes" })
  async getReadiness(@Req() request: PlatformPrincipalRequest & { correlationId?: string }) {
    const principal = currentPlatformPrincipal(request);
    return this.readiness.execute({
      actorOperatorId: principal.operatorId,
      correlationId: request.correlationId ?? crypto.randomUUID(),
      environment: process.env.APP_ENV ?? process.env.NODE_ENV ?? "unknown",
    });
  }
}
