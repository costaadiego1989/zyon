import { Body, Controller, Headers, HttpCode, Inject, Post, BadRequestException, ServiceUnavailableException, UnauthorizedException } from "@nestjs/common";
import { createHash, timingSafeEqual } from "node:crypto";
import { MarketplaceOperationalAlertService } from "../../application/services/marketplace-operational-alert.service.js";

@Controller("ops/marketplace")
export class MarketplaceOperationalAlertController {
  constructor(@Inject(MarketplaceOperationalAlertService) private readonly alerts: MarketplaceOperationalAlertService) {}
  @Post("alerts")
  @HttpCode(202)
  async receive(@Headers("authorization") authorization: string | undefined, @Body() body: unknown) {
    const secret = process.env.MARKETPLACE_ALERT_WEBHOOK_TOKEN?.trim();
    if (!secret || secret.length < 24) throw new ServiceUnavailableException("operational_alert_receiver_unconfigured");
    const supplied = typeof authorization === "string" ? authorization : "";
    const hash = (value: string) => createHash("sha256").update(value).digest();
    if (!timingSafeEqual(hash(supplied),hash(`Bearer ${secret}`))) throw new UnauthorizedException("operational_alert_receiver_unauthorized");
    try { return await this.alerts.receive(body); }
    catch (error) {
      const reason = error instanceof Error ? error.message : "";
      if (reason === "operational_alert_payload_invalid") throw new BadRequestException(reason);
      if (reason === "operational_alert_destination_unavailable") throw new ServiceUnavailableException(reason);
      throw new ServiceUnavailableException("operational_alert_persistence_unavailable");
    }
  }
}
