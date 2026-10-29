import { BadRequestException, Controller, Get, Query, Req, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { GetPlatformMetricsUseCase } from "../application/get-platform-metrics.use-case.js";
import { GetPlatformOverviewUseCase } from "../application/get-platform-overview.use-case.js";
import { PlatformAccessGuard } from "../../platform-control/presentation/platform-access.guard.js";
import { PlatformPermissionGuard } from "../../platform-control/presentation/platform-permission.guard.js";
import { RequirePlatformPermissions } from "../../platform-control/presentation/platform-permission.decorator.js";
import { currentPlatformPrincipal, type PlatformPrincipalRequest } from "../../platform-control/presentation/platform-principal.js";

@ApiTags("Platform Control Overview")
@ApiBearerAuth("PlatformOperatorJWT")
@UseGuards(PlatformAccessGuard, PlatformPermissionGuard)
@Controller("platform/overview")
export class PlatformOverviewController {
  constructor(
    private readonly overview: GetPlatformOverviewUseCase,
    private readonly metrics: GetPlatformMetricsUseCase,
  ) {}

  @Get()
  @RequirePlatformPermissions("platform:overview:read")
  @ApiOperation({ summary: "Read verified platform-control overview data" })
  async get(@Req() request: PlatformPrincipalRequest & { correlationId?: string }) {
    const principal = currentPlatformPrincipal(request);
    return this.overview.execute({
      actorOperatorId: principal.operatorId,
      correlationId: request.correlationId ?? crypto.randomUUID(),
      environment: process.env.APP_ENV ?? process.env.NODE_ENV ?? "unknown",
    });
  }

  @Get("metrics")
  @RequirePlatformPermissions("platform:overview:read")
  @ApiOperation({ summary: "Read period-based financial and AI metrics for platform control" })
  async getMetrics(
    @Query() query: { from?: string; to?: string; granularity?: string },
    @Req() request: PlatformPrincipalRequest & { correlationId?: string },
  ) {
    try {
      const principal = currentPlatformPrincipal(request);
      return await this.metrics.execute(query, {
        actorOperatorId: principal.operatorId,
        correlationId: request.correlationId ?? crypto.randomUUID(),
        environment: process.env.APP_ENV ?? process.env.NODE_ENV ?? "unknown",
      });
    } catch (error) {
      const code = error instanceof Error ? error.message : undefined;
      if (code && new Set([
        "platform_metrics_invalid_from",
        "platform_metrics_invalid_to",
        "platform_metrics_invalid_period",
        "platform_metrics_invalid_granularity",
      ]).has(code)) {
        throw new BadRequestException(code);
      }
      throw error;
    }
  }
}
