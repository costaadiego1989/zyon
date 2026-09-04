import { Body, Controller, Get, Patch, Req, UseGuards } from "@nestjs/common";
import { BuyerJwtAuthGuard, currentBuyer } from "./buyer-jwt-auth.guard.js";
import { GetBuyerPreferencesUseCase } from "../../application/use-cases/get-buyer-preferences.use-case.js";
import { UpdateBuyerPreferencesUseCase } from "../../application/use-cases/update-buyer-preferences.use-case.js";

@Controller("buyer/me/preferences")
export class BuyerPreferencesController {
  constructor(
    private readonly getPreferences: GetBuyerPreferencesUseCase,
    private readonly updatePreferences: UpdateBuyerPreferencesUseCase,
  ) {}

  @Get()
  @UseGuards(BuyerJwtAuthGuard)
  async get(@Req() req: { user?: unknown }) {
    const buyer = currentBuyer(req);
    return this.getPreferences.execute(buyer.globalUserId);
  }

  @Patch()
  @UseGuards(BuyerJwtAuthGuard)
  async patch(
    @Req() req: { user?: unknown },
    @Body() body: {
      email_opt_in?: boolean;
      sms_opt_in?: boolean;
      whatsapp_opt_in?: boolean;
      push_notifications_enabled?: boolean;
      m2m_negotiation_enabled?: boolean;
      language?: string;
    },
  ) {
    const buyer = currentBuyer(req);
    return this.updatePreferences.execute({
      globalUserId: buyer.globalUserId,
      emailOptIn: body.email_opt_in,
      smsOptIn: body.sms_opt_in,
      whatsappOptIn: body.whatsapp_opt_in,
      pushNotificationsEnabled: body.push_notifications_enabled,
      m2mNegotiationEnabled: body.m2m_negotiation_enabled,
      language: body.language,
    });
  }
}
