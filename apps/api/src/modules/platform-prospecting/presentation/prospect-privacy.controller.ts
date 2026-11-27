import { randomUUID } from "node:crypto";
import { Body, Controller, Get, Headers, HttpCode, Inject, Param, Post, Req, UseGuards } from "@nestjs/common";
import type { SuppressProspectCommand } from "@zyon/shared-types";
import { PROSPECTING_PORTS, type ProspectPrivacyPort } from "../domain/prospecting.ports.js";
import { PlatformAccessGuard } from "../../platform-control/presentation/platform-access.guard.js";
import { PlatformPermissionGuard } from "../../platform-control/presentation/platform-permission.guard.js";
import { RequirePlatformPermissions } from "../../platform-control/presentation/platform-permission.decorator.js";
import { currentPlatformPrincipal, type PlatformPrincipalRequest } from "../../platform-control/presentation/platform-principal.js";
import { prospectingHttpError, requestCommand } from "./prospecting-http-error.js";

@Controller("platform/prospecting") @UseGuards(PlatformAccessGuard, PlatformPermissionGuard)
export class ProspectPrivacyController {
  constructor(@Inject(PROSPECTING_PORTS.privacy) private readonly privacy: ProspectPrivacyPort) {}
  @Get("privacy") @RequirePlatformPermissions("platform:prospecting:admin") async policy() {
    try { return await this.privacy.policy(); } catch (error) { prospectingHttpError(error); }
  }
  @Post("prospects/:id/suppress") @HttpCode(200) @RequirePlatformPermissions("platform:prospecting:write") async suppress(@Param("id") id: string, @Body() body: unknown, @Headers("idempotency-key") key: string | undefined, @Req() request: PlatformPrincipalRequest) {
    try { return await this.privacy.suppress(id, requestCommand<SuppressProspectCommand>(body, key, ["expectedVersion", "reason"]), { operatorId: currentPlatformPrincipal(request).operatorId, correlationId: randomUUID() }); } catch (error) { prospectingHttpError(error); }
  }
}
