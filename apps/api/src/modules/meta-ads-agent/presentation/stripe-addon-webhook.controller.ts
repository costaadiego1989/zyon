import { Controller, Headers, HttpCode, Inject, Post, Req, UseFilters } from "@nestjs/common";
import { MetaAdsError } from "../domain/types.js";
import { MetaAdsAgentService } from "../application/meta-ads-agent.service.js";
import { MetaAdsHttpErrorFilter } from "./meta-ads-agent.controller.js";
@Controller("webhooks/stripe/meta-ads-agent")
@UseFilters(MetaAdsHttpErrorFilter)
export class StripeAddonWebhookController {
  constructor(@Inject(MetaAdsAgentService) private readonly service: MetaAdsAgentService) {}
  @Post() @HttpCode(200)
  async receive(@Req() request: { rawBody?: Buffer }, @Headers("stripe-signature") signature?: string) {
    if (!Buffer.isBuffer(request.rawBody)) throw new MetaAdsError("addon_webhook_raw_body_required");
    await this.service.billing.handleWebhook(request.rawBody, typeof signature === "string" ? signature : "");
    return { received: true };
  }
}
