import { randomUUID } from "node:crypto";
import { Body, Controller, Get, Headers, Inject, Param, Patch, Post, Query, Req, UseGuards } from "@nestjs/common";
import type { AddProspectsCommand, BindProspectContactCommand, ProspectListQuery, UpdateProspectCommand } from "@zyon/shared-types";
import { ProspectService } from "../application/crm/prospect.service.js";
import { PlatformAccessGuard } from "../../platform-control/presentation/platform-access.guard.js";
import { PlatformPermissionGuard } from "../../platform-control/presentation/platform-permission.guard.js";
import { RequirePlatformPermissions } from "../../platform-control/presentation/platform-permission.decorator.js";
import { currentPlatformPrincipal, type PlatformPrincipalRequest } from "../../platform-control/presentation/platform-principal.js";
import { prospectingHttpError, requestCommand, requestKeys, requestLimit, requestText } from "./prospecting-http-error.js";

@Controller("platform/prospecting") @UseGuards(PlatformAccessGuard, PlatformPermissionGuard)
@RequirePlatformPermissions("platform:prospecting:read")
export class ProspectController {
  constructor(@Inject(ProspectService) private readonly prospects: ProspectService) {}
  private actor(request: PlatformPrincipalRequest) { return { operatorId: currentPlatformPrincipal(request).operatorId, correlationId: randomUUID() }; }
  @Get("prospects") async list(@Query() raw: Record<string, unknown>) {
    try {
      requestKeys(raw, ["stage", "assignedOperatorId", "campaignId", "search", "cursor", "limit", "from", "to"]);
      let stage: ProspectListQuery["stage"]; if (raw.stage !== undefined) { if (typeof raw.stage !== "string" || raw.stage.length > 200) throw new Error("invalid_filter:stage"); try { stage = JSON.parse(raw.stage); } catch { throw new Error("invalid_filter:stage"); } }
      return await this.prospects.list({ stage, assignedOperatorId: requestText(raw.assignedOperatorId, "assignedOperatorId"), campaignId: requestText(raw.campaignId, "campaignId"), search: requestText(raw.search, "search"), cursor: requestText(raw.cursor, "cursor"), limit: requestLimit(raw.limit), from: requestText(raw.from, "from", 40), to: requestText(raw.to, "to", 40) });
    } catch (error) { prospectingHttpError(error); }
  }
  @Post("prospects") @RequirePlatformPermissions("platform:prospecting:write") async add(@Body() body: unknown, @Headers("idempotency-key") key: string | undefined, @Req() request: PlatformPrincipalRequest) {
    try { return await this.prospects.add(requestCommand<AddProspectsCommand>(body, key, ["snapshotId", "cnpjs", "selectionId"]), this.actor(request)); } catch (error) { prospectingHttpError(error); }
  }
  @Get("prospects/:id") async detail(@Param("id") id: string) { try { return await this.prospects.find(id); } catch (error) { prospectingHttpError(error); } }
  @Patch("prospects/:id") @RequirePlatformPermissions("platform:prospecting:write") async update(@Param("id") id: string, @Body() body: unknown, @Headers("idempotency-key") key: string | undefined, @Req() request: PlatformPrincipalRequest) {
    try { return await this.prospects.update(id, requestCommand<UpdateProspectCommand>(body, key, ["expectedVersion", "stage", "assignedOperatorId", "tags"]), this.actor(request)); } catch (error) { prospectingHttpError(error); }
  }
  @Post("prospects/:id/contact-binding") @RequirePlatformPermissions("platform:prospecting:write") async bind(@Param("id") id: string, @Body() body: unknown, @Headers("idempotency-key") key: string | undefined, @Req() request: PlatformPrincipalRequest) {
    try { return await this.prospects.bindContact(id, requestCommand<BindProspectContactCommand>(body, key, ["expectedVersion", "endpointId", "evidenceRef"]), this.actor(request)); } catch (error) { prospectingHttpError(error); }
  }
  @Get("commands/:clientRequestId") async command(@Param("clientRequestId") id: string, @Req() request: PlatformPrincipalRequest) {
    try { const result = await this.prospects.commandResult(id, this.actor(request)); if (!result) throw new Error("command_not_found"); return result; } catch (error) { prospectingHttpError(error); }
  }
}
