import { Body, Controller, Get, Post, Req, UseGuards } from "@nestjs/common";
import { BuyerJwtAuthGuard, currentBuyer } from "./buyer-jwt-auth.guard.js";
import { BuyerChannelIdentityService } from "../../application/services/buyer-channel-identity.service.js";
import { LinkBuyerWhatsAppUseCase } from "../../application/use-cases/link-buyer-whatsapp.use-case.js";

@Controller("buyer/me/channels/whatsapp")
@UseGuards(BuyerJwtAuthGuard)
export class BuyerWhatsAppLinkController {
  constructor(private readonly identities: BuyerChannelIdentityService, private readonly links: LinkBuyerWhatsAppUseCase) {}

  @Get()
  status(@Req() req: { user?: unknown }) { return this.identities.status(currentBuyer(req).globalUserId); }

  @Post("code")
  send(@Req() req: { user?: unknown }, @Body() body: { phone?: unknown }) {
    return this.links.send(currentBuyer(req).globalUserId, body.phone);
  }

  @Post("verify")
  verify(@Req() req: { user?: unknown }, @Body() body: { phone?: unknown; code?: unknown }) {
    return this.links.verify(currentBuyer(req).globalUserId, body.phone, body.code);
  }
}
