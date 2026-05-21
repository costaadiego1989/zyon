import { Body, Controller, Get, Param, Put, Req, UseGuards } from "@nestjs/common";
import { GetTrackingTimelineUseCase, UpdateTenantOrderTrackingUseCase } from "../../application/integrations.use-cases.js";
import { currentApiKey, MerchantApiKeyGuard } from "./merchant-api-key.guard.js";

@UseGuards(MerchantApiKeyGuard)
@Controller("integrations")
export class TenantTrackingController {
  constructor(
    private readonly updateTracking: UpdateTenantOrderTrackingUseCase,
    private readonly getTimeline: GetTrackingTimelineUseCase
  ) {}

  @Put("orders/:externalOrderId/tracking")
  update(@Req() request: unknown, @Param("externalOrderId") externalOrderId: string, @Body() body: Record<string, unknown>) {
    return this.updateTracking.execute({
      context: currentApiKey(request as { apiKey?: unknown }),
      externalOrderId,
      body: body as any
    });
  }

  @Get("tracking/:trackingCode")
  timeline(@Req() request: unknown, @Param("trackingCode") trackingCode: string) {
    return this.getTimeline.execute({
      merchantId: currentApiKey(request as { apiKey?: unknown }).merchantId,
      trackingCode
    });
  }
}
