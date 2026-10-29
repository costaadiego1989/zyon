import { Controller, Get, Query, Req, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { ListPlatformBillingReceivablesUseCase } from "../application/list-platform-billing-receivables.use-case.js";
import { PlatformAccessGuard } from "./platform-access.guard.js";
import { throwPlatformBillingHttpError } from "./platform-billing.http-errors.js";
import { PlatformPermissionGuard } from "./platform-permission.guard.js";
import { RequirePlatformPermissions } from "./platform-permission.decorator.js";
import { currentPlatformPrincipal, type PlatformPrincipalRequest } from "./platform-principal.js";

@ApiTags("Platform Control Billing")
@ApiBearerAuth("PlatformOperatorJWT")
@UseGuards(PlatformAccessGuard, PlatformPermissionGuard)
@Controller("platform/billing/receivables")
export class PlatformBillingReceivablesController {
  constructor(private readonly receivables: ListPlatformBillingReceivablesUseCase) {}

  @Get()
  @RequirePlatformPermissions("platform:billing:read")
  @ApiOperation({ summary: "List observed Asaas and Stripe subscription receivables for platform operators" })
  async list(
    @Query() query: { cursor?: unknown; limit?: unknown; status?: unknown },
    @Req() request: PlatformPrincipalRequest & { correlationId?: string },
  ) {
    try {
      const principal = currentPlatformPrincipal(request);
      return await this.receivables.execute(query, {
        actorOperatorId: principal.operatorId,
        correlationId: request.correlationId ?? crypto.randomUUID(),
        environment: process.env.APP_ENV ?? process.env.NODE_ENV ?? "unknown",
      });
    } catch (error) {
      throwPlatformBillingHttpError(error);
    }
  }
}
