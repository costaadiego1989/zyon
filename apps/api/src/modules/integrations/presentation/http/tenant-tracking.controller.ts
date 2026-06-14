import { Body, Controller, Get, Param, Put, Req, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { Idempotent } from "../../../../shared/http/idempotency/idempotent.decorator.js";
import { GetTrackingTimelineUseCase, UpdateTenantOrderTrackingUseCase } from "../../application/integrations.use-cases.js";
import { RequireApiKeyScopes } from "./api-key-scope.decorator.js";
import { ApiKeyScopeGuard } from "./api-key-scope.guard.js";
import { currentApiKey, MerchantApiKeyGuard } from "./merchant-api-key.guard.js";

@ApiTags("Order tracking")
@ApiBearerAuth("service_api_key")
@UseGuards(MerchantApiKeyGuard, ApiKeyScopeGuard)
@Controller("integrations")
export class TenantTrackingController {
  constructor(
    private readonly updateTracking: UpdateTenantOrderTrackingUseCase,
    private readonly getTimeline: GetTrackingTimelineUseCase
  ) {}

  @Put("orders/:externalOrderId/tracking")
  @Idempotent()
  @RequireApiKeyScopes("tracking:write")
  update(@Req() request: unknown, @Param("externalOrderId") externalOrderId: string, @Body() body: Record<string, unknown>) {
    return this.updateTracking.execute({
      context: currentApiKey(request as { apiKey?: unknown }),
      externalOrderId,
      body: body as any
    });
  }

  @Get("tracking/:trackingCode")
  @RequireApiKeyScopes("tracking:read")
  timeline(@Req() request: unknown, @Param("trackingCode") trackingCode: string) {
    return this.getTimeline.execute({
      merchantId: currentApiKey(request as { apiKey?: unknown }).merchantId,
      trackingCode
    });
  }
}
