import { Controller, Get, Header, ServiceUnavailableException } from "@nestjs/common";
import { BillingPromotionsService } from "./billing-promotions.service.js";

/** Only explicitly public campaigns. Administration stays behind platform guards. */
@Controller("billing/promotions")
export class BillingPublicPromotionsController {
  constructor(private readonly promotions: BillingPromotionsService) {}
  @Get("automatic")
  @Header("Cache-Control", "no-store")
  async automatic() {
    try { return { campaigns: await this.promotions.automatic() }; }
    catch { throw new ServiceUnavailableException("billing_promotions_unavailable"); }
  }
}
