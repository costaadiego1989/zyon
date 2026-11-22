import { randomUUID } from "node:crypto";
import { Body, Controller, Delete, Get, Headers, HttpCode, Inject, Param, Patch, Post, Query, Req, UseGuards } from "@nestjs/common";
import type { ProspectingVersionedCommand, SavedProspectSegment, SaveProspectSegment, ProspectSegmentSummary } from "@zyon/shared-types";
import { PROSPECTING_PORTS, type CompanyDirectoryPort, type SegmentRepositoryPort } from "../domain/prospecting.ports.js";
import { PlatformAccessGuard } from "../../platform-control/presentation/platform-access.guard.js";
import { PlatformPermissionGuard } from "../../platform-control/presentation/platform-permission.guard.js";
import { RequirePlatformPermissions } from "../../platform-control/presentation/platform-permission.decorator.js";
import { currentPlatformPrincipal, type PlatformPrincipalRequest } from "../../platform-control/presentation/platform-principal.js";
import { prospectingHttpError, requestCommand, requestKeys, requestText } from "./prospecting-http-error.js";

@Controller("platform/prospecting/segments") @UseGuards(PlatformAccessGuard, PlatformPermissionGuard)
@RequirePlatformPermissions("platform:prospecting:read")
export class ProspectSegmentController {
  constructor(@Inject(PROSPECTING_PORTS.segments) private readonly segments: SegmentRepositoryPort, @Inject(PROSPECTING_PORTS.directory) private readonly directory: CompanyDirectoryPort) {}
  private actor(request: PlatformPrincipalRequest) { return { operatorId: currentPlatformPrincipal(request).operatorId, correlationId: randomUUID() }; }
  private async counted(segment: SavedProspectSegment): Promise<ProspectSegmentSummary> {
    const page = await this.directory.search({ filters: segment.filters, limit: 1 });
    return { ...segment, count: page.count, countState: page.countState, snapshotId: page.snapshotId };
  }
  @Get() async list(@Query() raw: Record<string, unknown>) {
    try { requestKeys(raw, ["cursor"]); const page = await this.segments.list(requestText(raw.cursor, "cursor")); const items: ProspectSegmentSummary[] = []; for (const segment of page.items) items.push(await this.counted(segment)); return { ...page, items }; } catch (error) { prospectingHttpError(error); }
  }
  @Get(":id") async detail(@Param("id") id: string) {
    try { const segment = await this.segments.find(id); if (!segment) throw new Error("segment_not_found"); return await this.counted(segment); } catch (error) { prospectingHttpError(error); }
  }
  @Post() @RequirePlatformPermissions("platform:prospecting:write") async create(@Body() body: unknown, @Headers("idempotency-key") key: string | undefined, @Req() request: PlatformPrincipalRequest) {
    try { return await this.counted(await this.segments.save(null, requestCommand<SaveProspectSegment>(body, key, ["name", "filters", "filterVersion"]), this.actor(request))); } catch (error) { prospectingHttpError(error); }
  }
  @Patch(":id") @RequirePlatformPermissions("platform:prospecting:write") async edit(@Param("id") id: string, @Body() body: unknown, @Headers("idempotency-key") key: string | undefined, @Req() request: PlatformPrincipalRequest) {
    try { return await this.counted(await this.segments.save(id, requestCommand<SaveProspectSegment>(body, key, ["name", "filters", "filterVersion", "expectedVersion"]), this.actor(request))); } catch (error) { prospectingHttpError(error); }
  }
  @Delete(":id") @HttpCode(204) @RequirePlatformPermissions("platform:prospecting:write") async remove(@Param("id") id: string, @Body() body: unknown, @Headers("idempotency-key") key: string | undefined, @Req() request: PlatformPrincipalRequest) {
    try { await this.segments.remove(id, requestCommand<ProspectingVersionedCommand>(body, key, ["expectedVersion"]), this.actor(request)); } catch (error) { prospectingHttpError(error); }
  }
}
