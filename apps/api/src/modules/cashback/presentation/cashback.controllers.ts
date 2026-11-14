import { Body, Controller, ForbiddenException, Get, Header, NotFoundException, Param, Patch, Post, Query, Req, UseFilters, UseGuards } from "@nestjs/common";
import type { CashbackRules } from "@zyon/shared-types";
import { AuthGuard, currentUser } from "../../auth/presentation/auth.guard.js";
import { BuyerJwtAuthGuard, currentBuyer } from "../../buyer-account/presentation/http/buyer-jwt-auth.guard.js";
import { EmbedAuthGuard } from "../../embed/presentation/http/embed-auth.guard.js";
import { RequireEmbedScope } from "../../embed/presentation/http/embed-scope.decorator.js";
import { EmbedCheckoutGuardHelper, type EmbedHttpRequest } from "../../embed/presentation/http/embed-checkout.controller.js";
import { RateLimit } from "../../../shared/http/rate-limit.guard.js";
import { CashbackService } from "../application/cashback.service.js";
import { CashbackQueriesService, type CashbackListQuery } from "../application/cashback-queries.service.js";
import { CashbackError } from "../domain/cashback.js";
import { CashbackErrorFilter } from "./cashback-error.filter.js";

function merchant(req: { user?: unknown }) {
  const principal = currentUser(req);
  if (!["owner", "admin"].includes(principal.role)) throw new ForbiddenException("cashback_permission_denied");
  return principal;
}

@Controller("dashboard/cashback")
@UseGuards(AuthGuard)
@UseFilters(CashbackErrorFilter)
@RateLimit(90)
export class CashbackMerchantController {
  constructor(private readonly service: CashbackService, private readonly queries: CashbackQueriesService) {}
  @Get("program") @Header("Cache-Control", "no-store")
  getProgram(@Req() req: { user?: unknown }) { return this.service.getProgram(merchant(req).merchantId, { includeGeneralCap: true }); }
  @Patch("program")
  async saveDraft(@Req() req: { user?: unknown }, @Body() body: { rules: Partial<CashbackRules> }) {
    const user = merchant(req); await this.service.saveDraft(user.merchantId, body?.rules, user.userId);
    return this.service.getProgram(user.merchantId, { includeGeneralCap: true });
  }
  @Post("program/publish")
  async publish(@Req() req: { user?: unknown }) { const user = merchant(req); await this.service.publishProgram(user.merchantId, user.userId, { requireCombination: true }); return this.service.getProgram(user.merchantId, { includeGeneralCap: true }); }
  @Post("program/pause")
  async pause(@Req() req: { user?: unknown }) { const user = merchant(req); await this.service.pauseProgram(user.merchantId, user.userId); return this.service.getProgram(user.merchantId, { includeGeneralCap: true }); }
  @Post("program/end")
  async end(@Req() req: { user?: unknown }) { const user = merchant(req); await this.service.pauseProgram(user.merchantId, user.userId, true); return this.service.getProgram(user.merchantId, { includeGeneralCap: true }); }
  @Get("metrics") @Header("Cache-Control", "no-store")
  metrics(@Req() req: { user?: unknown }, @Query() query: CashbackListQuery) { return this.queries.metrics(merchant(req).merchantId, query); }
  @Get("customers") @Header("Cache-Control", "no-store")
  customers(@Req() req: { user?: unknown }, @Query() query: CashbackListQuery) { return this.queries.customers(merchant(req).merchantId, query); }
  @Get("customers/:buyerId") @Header("Cache-Control", "no-store")
  customer(@Req() req: { user?: unknown }, @Param("buyerId") buyerId: string) { return this.service.wallet(merchant(req).merchantId, buyerId); }
  @Get("transactions") @Header("Cache-Control", "no-store")
  transactions(@Req() req: { user?: unknown }, @Query() query: CashbackListQuery) { return this.queries.transactions(merchant(req).merchantId, query); }
  @Get("exports") @Header("Cache-Control", "no-store") @Header("Content-Type", "text/csv; charset=utf-8") @Header("Content-Disposition", "attachment; filename=cashback.csv")
  export(@Req() req: { user?: unknown }, @Query() query: CashbackListQuery & { kind?: string }) { return this.queries.exportCsv(merchant(req).merchantId, query); }
  @Post("customers/:buyerId/adjustments") @RateLimit(20)
  adjustment(@Req() req: { user?: unknown }, @Param("buyerId") buyerId: string, @Body() body: { amountCents: number; reason: string; idempotencyKey: string; expiryDays: number | null }) {
    const user = merchant(req); return this.service.adjustWallet(user.merchantId, buyerId, body, user.userId);
  }
}

@Controller("buyer/me/cashback")
@UseGuards(BuyerJwtAuthGuard)
@UseFilters(CashbackErrorFilter)
@RateLimit(90)
export class CashbackBuyerController {
  constructor(private readonly service: CashbackService, private readonly queries: CashbackQueriesService) {}
  private async principal(req: { user?: unknown }, merchantId?: string) {
    const buyer = currentBuyer(req);
    const id = buyer.merchantId ?? merchantId;
    if (!id || (merchantId && buyer.merchantId && merchantId !== buyer.merchantId)) throw new ForbiddenException("cashback_merchant_binding_required");
    if (!buyer.merchantId) {
      const rows = await this.service.repository.prisma.$queryRaw<Array<{ valid: boolean }>>`SELECT (
        EXISTS(SELECT 1 FROM buyer_identities WHERE merchant_id=${id} AND global_user_id=${buyer.globalUserId}) OR
        EXISTS(SELECT 1 FROM checkout_sessions WHERE merchant_id=${id} AND global_user_id=${buyer.globalUserId}) OR
        EXISTS(SELECT 1 FROM buyer_verified_phones vp JOIN buyer_identities bi ON bi.identity_key='phone:'||vp.phone
          WHERE vp.buyer_id=${buyer.globalUserId} AND bi.merchant_id=${id}) OR
        EXISTS(SELECT 1 FROM cashback_wallets WHERE merchant_id=${id} AND buyer_id=${buyer.globalUserId})) AS valid`;
      if (!rows[0]?.valid) throw new ForbiddenException("cashback_merchant_binding_required");
    }
    return { merchantId: id, buyerId: buyer.globalUserId };
  }
  @Get() @Header("Cache-Control", "no-store")
  async wallet(@Req() req: { user?: unknown }, @Query("merchant_id") merchantId?: string) {
    const p = await this.principal(req, merchantId); return this.service.wallet(p.merchantId, p.buyerId);
  }
  @Get("transactions") @Header("Cache-Control", "no-store")
  async transactions(@Req() req: { user?: unknown }, @Query() query: CashbackListQuery & { merchant_id?: string }) {
    const p = await this.principal(req, query.merchant_id); return this.queries.transactions(p.merchantId, { ...query, buyerId: p.buyerId });
  }
}

@Controller("embed/cashback")
@UseGuards(EmbedAuthGuard)
@UseFilters(CashbackErrorFilter)
@RateLimit(60)
export class CashbackEmbedController {
  constructor(private readonly service: CashbackService, private readonly guards: EmbedCheckoutGuardHelper) {}
  private async session(request: EmbedHttpRequest, body: { session_id: string }) {
    if (!request.embedClaims || !body || typeof body.session_id !== "string") throw new CashbackError("cashback_session_required");
    await this.guards.assertSessionBelongsToEmbedMerchant(request.embedClaims, body.session_id);
    const session = await this.guards.loadSession(request.embedClaims.merchantId, body.session_id);
    if (!session) throw new NotFoundException("checkout_session_not_found"); return session;
  }
  @Post("quote") @Header("Cache-Control", "no-store")
  @RequireEmbedScope("payment:intents:read")
  async quote(@Req() req: EmbedHttpRequest, @Body() body: { session_id: string }) { return this.service.quoteCheckout(await this.session(req, body)); }
  @Post("reserve")
  @RequireEmbedScope("offers:apply")
  async reserve(@Req() req: EmbedHttpRequest, @Body() body: { session_id: string; amount_cents: number; idempotency_key: string }) {
    return this.service.reserveCheckout(await this.session(req, body), body.amount_cents, body.idempotency_key);
  }
  @Post("remove")
  @RequireEmbedScope("offers:apply")
  async remove(@Req() req: EmbedHttpRequest, @Body() body: { session_id: string; idempotency_key: string }) {
    if (!body?.idempotency_key) throw new CashbackError("cashback_idempotency_key_required");
    return this.service.releaseReservation(await this.session(req, body), body.idempotency_key);
  }
}
