import { Controller, Get, Req, UseGuards } from "@nestjs/common";
import { GetBuyerIntentProfileUseCase } from "../../application/use-cases/get-buyer-intent-profile.use-case.js";
import { BuyerJwtAuthGuard, currentBuyer } from "./buyer-jwt-auth.guard.js";

@Controller("buyer/me/intent-profile")
@UseGuards(BuyerJwtAuthGuard)
export class BuyerIntentController {
  constructor(private readonly getIntentProfile: GetBuyerIntentProfileUseCase) {}

  @Get()
  async get(@Req() req: { user?: unknown }) {
    const buyer = currentBuyer(req);
    return this.getIntentProfile.execute(buyer.globalUserId, buyer.merchantId);
  }
}
