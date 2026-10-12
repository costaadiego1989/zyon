import { BadRequestException, Body, Controller, Delete, Get, Post, Req, UseGuards, NotFoundException, Inject, Query } from "@nestjs/common";
import type { PrismaClient } from "@prisma/client";
import { BuyerJwtAuthGuard, currentBuyer } from "../../../buyer-account/presentation/http/buyer-jwt-auth.guard.js";
import { PRISMA_CLIENT } from "../../../../shared/persistence/persistence.module.js";
import { ReturnCaseService, type OpenReturnCaseInput } from "../../application/return-case.service.js";
import { ReturnOrderService } from "../../application/return-order.service.js";

@Controller("buyer/returns")
@UseGuards(BuyerJwtAuthGuard)
export class BuyerReturnsController {
  constructor(private readonly cases: ReturnCaseService, private readonly orders: ReturnOrderService,
    @Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient) {}
  private draftScope(req: any, merchantId: string) {
    const buyer = currentBuyer(req);
    if (typeof merchantId !== "string" || !merchantId || (buyer.merchantId && buyer.merchantId !== merchantId)) throw new BadRequestException("merchant_not_allowed");
    return { merchantId, buyerId: buyer.globalUserId };
  }
  @Get("draft")
  async draft(@Req() req: any, @Query("merchantId") merchantId: string) {
    const row = await this.prisma.returnDraft.findUnique({ where: { merchantId_buyerId: this.draftScope(req, merchantId) } });
    return { data: row && row.updatedAt.getTime() > Date.now() - 30 * 86400000 ? row.data : null };
  }
  @Post("draft")
  async saveDraft(@Req() req: any, @Body() body: { merchantId: string; data: { orderId?: string; step?: number; kind?: string; reason?: string; notes?: string; items?: unknown; requestKey?: string } }) {
    const scope = this.draftScope(req, body.merchantId);
    if (!body.data || JSON.stringify(body.data).length > 12000) throw new BadRequestException("invalid_return_draft");
    const { orderId, step, kind, reason, notes, items, requestKey } = body.data;
    const data = JSON.parse(JSON.stringify({ orderId, step, kind, reason, notes, items, requestKey }));
    if (JSON.stringify(data).includes("data:image")) throw new BadRequestException("invalid_return_draft");
    await this.prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`return-order:${scope.merchantId}:${orderId}`},0))::text`;
      const opened = typeof requestKey === "string" ? await tx.return.findFirst({ where: { ...scope, requestKey } }) : null;
      if (!opened) await tx.returnDraft.upsert({ where: { merchantId_buyerId: scope }, create: { ...scope, data }, update: { data } });
    });
    return { success: true };
  }
  @Delete("draft")
  async clearDraft(@Req() req: any, @Query("merchantId") merchantId: string) {
    await this.prisma.returnDraft.deleteMany({ where: this.draftScope(req, merchantId) });
    return { success: true };
  }
  @Post("request")
  createReturnRequest(@Req() req: any, @Body() body: Omit<OpenReturnCaseInput, "buyerId"> & { title?: string; description?: string }) {
    const buyer = currentBuyer(req);
    if (buyer.merchantId && buyer.merchantId !== body.merchantId) throw new NotFoundException("buyer_order_not_found");
    return this.cases.open({ ...body, buyerId: buyer.globalUserId, notes: body.notes ?? [body.title, body.description].filter(Boolean).join(" — ") });
  }
  @Get("orders")
  async eligibleOrders(@Req() req: any, @Query("merchantId") merchantId?: string) {
    const buyer = currentBuyer(req);
    const scope = buyer.merchantId ?? merchantId;
    const purchases = await this.prisma.buyerPurchaseRecord.findMany({ where: { globalUserId: buyer.globalUserId, ...(scope ? { merchantId: scope } : {}) }, orderBy: { completedAt: "desc" }, take: 100 });
    const items = await Promise.all(purchases.map(p => this.orders.load(p.merchantId, p.orderId, buyer.globalUserId).catch(() => null)));
    return { items: items.filter(Boolean) };
  }
  @Get()
  async listMyReturns(@Req() req: any, @Query("merchantId") merchantId?: string) {
    const buyer = currentBuyer(req);
    return this.cases.list(buyer.globalUserId, buyer.merchantId ?? merchantId);
  }
}
