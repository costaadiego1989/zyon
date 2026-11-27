import { Body, Controller, Get, Optional, Post, Req, ServiceUnavailableException, UseGuards } from "@nestjs/common";
import { BuyerJwtAuthGuard, currentBuyer } from "./buyer-jwt-auth.guard.js";
import { BuyerChannelIdentityService } from "../../application/services/buyer-channel-identity.service.js";
import { LinkBuyerWhatsAppUseCase } from "../../application/use-cases/link-buyer-whatsapp.use-case.js";
import { BuyerInboundWhatsAppLinkUseCase } from "../../application/use-cases/buyer-inbound-whatsapp-link.use-case.js";

@Controller("buyer/me/channels/whatsapp")
@UseGuards(BuyerJwtAuthGuard)
export class BuyerWhatsAppLinkController {
  constructor(private readonly identities: BuyerChannelIdentityService, private readonly links: LinkBuyerWhatsAppUseCase,
    @Optional() private readonly inbound?: BuyerInboundWhatsAppLinkUseCase) {}

  @Post("inbound")
  createInbound(@Req() req: { user?: unknown }, @Body() body: { phone?: unknown; merchantId?: unknown }) {
    const buyer = currentBuyer(req);
    if (!this.inbound) throw new ServiceUnavailableException("whatsapp_link_channel_unavailable");
    return this.inbound.create(buyer.globalUserId, body.phone, body.merchantId, buyer.merchantId);
  }

  @Post("inbound/status")
  inboundStatus(@Req() req: { user?: unknown }, @Body() body: { token?: unknown }) {
    const buyer = currentBuyer(req);
    if (!this.inbound) throw new ServiceUnavailableException("whatsapp_link_channel_unavailable");
    return this.inbound.status(buyer.globalUserId, body.token, buyer.merchantId);
  }

  @Get()
  status(@Req() req: { user?: unknown }) { return this.identities.status(currentBuyer(req).globalUserId); }

  @Post("code")
  send(@Req() req: { user?: unknown }, @Body() body: { phone?: unknown; merchantId?: unknown }) {
    return this.links.send(currentBuyer(req).globalUserId, body.phone, body.merchantId);
  }

  @Post("verify")
  verify(@Req() req: { user?: unknown }, @Body() body: { phone?: unknown; code?: unknown; merchantId?: unknown }) {
    return this.links.verify(currentBuyer(req).globalUserId, body.phone, body.code, body.merchantId);
  }
}
