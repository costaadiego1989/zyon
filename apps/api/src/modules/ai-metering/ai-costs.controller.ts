import { Controller, Get, Query, Req, Res, UseGuards } from "@nestjs/common";
import type { Response } from "express";
import { PlatformAccessGuard } from "../platform-control/presentation/platform-access.guard.js";
import { PlatformPermissionGuard } from "../platform-control/presentation/platform-permission.guard.js";
import { RequirePlatformPermissions } from "../platform-control/presentation/platform-permission.decorator.js";
import { currentPlatformPrincipal, type PlatformPrincipalRequest } from "../platform-control/presentation/platform-principal.js";
import { AiCostsReader, csvCell, type CostQuery } from "./ai-costs.reader.js";
@UseGuards(PlatformAccessGuard, PlatformPermissionGuard)
@Controller("platform/ai-costs")
export class AiCostsController {
  constructor(private readonly reader: AiCostsReader) {}
  @Get()
  @RequirePlatformPermissions("platform:ai-usage:read")
  async report(@Query() query: CostQuery, @Req() request: PlatformPrincipalRequest) {
    const result = await this.reader.report(query);
    await this.reader.audit(currentPlatformPrincipal(request).operatorId,"ai_costs.report.read",query); return result;
  }
  @Get("events")
  @RequirePlatformPermissions("platform:ai-usage:read")
  async events(@Query() query: CostQuery, @Req() request: PlatformPrincipalRequest) {
    const result = await this.reader.events(query);
    await this.reader.audit(currentPlatformPrincipal(request).operatorId,"ai_costs.events.read",query); return result;
  }
  @Get("export")
  @RequirePlatformPermissions("platform:ai-usage:read","platform:exports:read")
  async csv(@Query() query: CostQuery, @Req() request: PlatformPrincipalRequest, @Res() response: Response) {
    const until = query.to ?? new Date().toISOString();
    let page = await this.reader.events({ ...query,to:until },500);
    await this.reader.audit(currentPlatformPrincipal(request).operatorId,"ai_costs.export.read",query);
    response.setHeader("Content-Type","text/csv; charset=utf-8"); response.setHeader("Content-Disposition",'attachment; filename="consumo-ia.csv"'); response.setHeader("Cache-Control","no-store");
    const fields = ["at","merchantId","merchantName","accountId","source","provider","model","component","costCenter","payer","inputTokens","outputTokens","totalTokens","costMicros","currency","costStatus","pricingVersion","status","measurementOrigin","providerEventId","conversationId","voiceSessionId"];
    response.write("\uFEFF"+fields.map(csvCell).join(",")+"\r\n");
    while (!response.destroyed) {
      for (const row of page.items) { if (!response.write(fields.map(f=>csvCell(row[f] instanceof Date ? row[f].toISOString() : row[f])).join(",")+"\r\n")) await new Promise<void>(resolve=>{response.once("drain",resolve);response.once("close",resolve);}); }
      if (!page.nextCursor) break;
      page = await this.reader.events({ ...query,to:until,cursor:page.nextCursor },500);
    }
    if (!response.destroyed) response.end();
  }
}
