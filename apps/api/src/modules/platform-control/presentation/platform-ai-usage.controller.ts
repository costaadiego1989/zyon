import { Controller, Get, Query, Req, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { ListPlatformAiUsageByMerchantUseCase } from "../application/list-platform-ai-usage-by-merchant.use-case.js";
import { PlatformAccessGuard } from "./platform-access.guard.js";
import { PlatformPermissionGuard } from "./platform-permission.guard.js";
import { RequirePlatformPermissions } from "./platform-permission.decorator.js";
import { throwPlatformAiUsageHttpError } from "./platform-ai-usage.http-errors.js";
import { currentPlatformPrincipal, type PlatformPrincipalRequest } from "./platform-principal.js";

@ApiTags("Platform Control AI Usage")
@ApiBearerAuth("PlatformOperatorJWT")
@UseGuards(PlatformAccessGuard, PlatformPermissionGuard)
@Controller("platform/ai-usage")
export class PlatformAiUsageController {
  constructor(private readonly listUsage: ListPlatformAiUsageByMerchantUseCase) {}

  @Get("merchants")
  @RequirePlatformPermissions("platform:ai-usage:read")
  @ApiOperation({ summary: "List server-captured chat AI usage by merchant" })
  async listByMerchant(
    @Query() query: { from?: string; to?: string; limit?: string },
    @Req() request: PlatformPrincipalRequest & { correlationId?: string },
  ) {
    try {
      const principal = currentPlatformPrincipal(request);
      return await this.listUsage.execute(query, {
        actorOperatorId: principal.operatorId,
        correlationId: request.correlationId ?? crypto.randomUUID(),
        environment: process.env.APP_ENV ?? process.env.NODE_ENV ?? "unknown",
      });
    } catch (error) {
      throwPlatformAiUsageHttpError(error);
    }
  }
}
