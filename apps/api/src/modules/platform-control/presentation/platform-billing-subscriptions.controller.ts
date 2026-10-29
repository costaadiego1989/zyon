import { Controller, Get, Query, Req, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { ListPlatformBillingSubscriptionsUseCase } from "../application/list-platform-billing-subscriptions.use-case.js";
import { PlatformAccessGuard } from "./platform-access.guard.js";
import { throwPlatformBillingHttpError } from "./platform-billing.http-errors.js";
import { PlatformPermissionGuard } from "./platform-permission.guard.js";
import { RequirePlatformPermissions } from "./platform-permission.decorator.js";
import { currentPlatformPrincipal, type PlatformPrincipalRequest } from "./platform-principal.js";

@ApiTags("Platform Control Billing")
@ApiBearerAuth("PlatformOperatorJWT")
@UseGuards(PlatformAccessGuard, PlatformPermissionGuard)
@Controller("platform/billing/subscriptions")
export class PlatformBillingSubscriptionsController {
  constructor(private readonly subscriptions: ListPlatformBillingSubscriptionsUseCase) {}

  @Get()
  @RequirePlatformPermissions("platform:billing:read")
  @ApiOperation({ summary: "List local billing subscription states for platform operators" })
  async list(
    @Query() query: { cursor?: unknown; limit?: unknown; status?: unknown; provider?: unknown },
    @Req() request: PlatformPrincipalRequest & { correlationId?: string },
  ) {
    try {
      const principal = currentPlatformPrincipal(request);
      return await this.subscriptions.execute(query, {
        actorOperatorId: principal.operatorId,
        correlationId: request.correlationId ?? crypto.randomUUID(),
        environment: process.env.APP_ENV ?? process.env.NODE_ENV ?? "unknown",
      });
    } catch (error) {
      throwPlatformBillingHttpError(error);
    }
  }
}
