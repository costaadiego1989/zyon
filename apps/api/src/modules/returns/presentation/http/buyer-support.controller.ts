import { BadRequestException, Body, Controller, Get, Param, Post, Query, Req, UseGuards } from "@nestjs/common";
import { BuyerJwtAuthGuard, currentBuyer } from "../../../buyer-account/presentation/http/buyer-jwt-auth.guard.js";
import { ReturnCaseService } from "../../application/return-case.service.js";

@Controller("buyer/support/tickets")
@UseGuards(BuyerJwtAuthGuard)
export class BuyerSupportController {
  constructor(private readonly cases: ReturnCaseService) {}
  @Get()
  list(@Req() req: any, @Query("merchantId") merchantId?: string) {
    const buyer = currentBuyer(req);
    return this.cases.list(buyer.globalUserId, buyer.merchantId ?? merchantId);
  }
  @Post()
  create(@Req() req: any, @Body() body: { merchantId: string; content: string; clientMessageId: string; images?: unknown }) {
    const buyer = currentBuyer(req);
    if (buyer.merchantId && buyer.merchantId !== body.merchantId) throw new BadRequestException("merchant_not_allowed");
    this.rejectPhotos(body.images);
    return this.cases.genericOpen(body.merchantId, buyer.globalUserId, body.content, body.clientMessageId);
  }
  @Get(":id")
  async detail(@Req() req: any, @Param("id") id: string, @Query("cursor") cursor?: string) {
    const buyer = currentBuyer(req);
    const ticket = await this.cases.buyerTicket(buyer.globalUserId, id, buyer.merchantId);
    return this.cases.detail(ticket.merchantId, ticket.id, cursor);
  }
  @Post(":id/messages")
  async send(@Req() req: any, @Param("id") id: string, @Body() body: { content: string; clientMessageId: string; images?: unknown }) {
    const buyer = currentBuyer(req);
    const ticket = await this.cases.buyerTicket(buyer.globalUserId, id, buyer.merchantId);
    this.rejectPhotos(body.images);
    return this.cases.sendMessage(ticket.merchantId, ticket.id, buyer.globalUserId, body.content, body.clientMessageId);
  }
  private rejectPhotos(images: unknown) {
    if (images !== undefined && (!Array.isArray(images) || images.length > 0)) throw new BadRequestException("photos_only_return_opening");
  }
  @Post(":id/read")
  async read(@Req() req: any, @Param("id") id: string, @Body() body: { lastMessageId: string }) {
    const buyer = currentBuyer(req);
    const ticket = await this.cases.buyerTicket(buyer.globalUserId, id, buyer.merchantId);
    return this.cases.markRead(ticket.merchantId, ticket.id, "buyer", body.lastMessageId);
  }
  @Post(":id/realtime")
  realtime(@Req() req: any, @Param("id") id: string) {
    const buyer = currentBuyer(req);
    return this.cases.realtime(buyer.globalUserId, id, req.headers.origin, buyer.merchantId);
  }
}
