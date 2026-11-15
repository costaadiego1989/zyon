import { Body, Controller, ForbiddenException, Header, Inject, Param, Post, Req, Res, UnauthorizedException, UseFilters } from "@nestjs/common";
import type { Response } from "express";
import { RealtimeCapabilityService } from "../../../shared/auth/realtime-capability.js";
import { AttributionService } from "../application/attribution.service.js";
import { MetaAdsAgentService } from "../application/meta-ads-agent.service.js";
import { MetaAdsError, META_ADS_SESSION_BINDING, type AttributionSessionBindingPort } from "../domain/types.js";
import { MetaAdsHttpErrorFilter } from "./meta-ads-agent.controller.js";
type Request = { headers?: { authorization?: string; origin?: string; "user-agent"?: string } };
function bodyFields<T>(body: unknown, allowed: string[]): T {
  if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).some(key => !allowed.includes(key))) throw new MetaAdsError("request_fields_invalid");
  return body as T;
}
@Controller("storefront/conversations/:conversationId/meta-ads")
@UseFilters(MetaAdsHttpErrorFilter)
export class AttributionController {
  constructor(@Inject(AttributionService) private readonly attribution: AttributionService, @Inject(RealtimeCapabilityService) private readonly capabilities: RealtimeCapabilityService,
    @Inject(META_ADS_SESSION_BINDING) private readonly binding: AttributionSessionBindingPort, @Inject(MetaAdsAgentService) private readonly service: MetaAdsAgentService) {}
  private access(request: Request, conversationId: string) {
    let claims;
    try {
      const origin = request.headers?.origin;
      claims = this.capabilities.verify(request.headers?.authorization?.match(/^Bearer (\S+)$/i)?.[1], "storefront-conversation", origin);
      if (!origin || claims.origin !== origin) throw new Error("unbound_origin");
    } catch { throw new UnauthorizedException("invalid_conversation_token"); }
    if (claims.resourceId !== conversationId) throw new ForbiddenException("attribution_session_forbidden");
    return claims;
  }
  private async checkout(merchantId: string, conversationId: string, checkoutSessionId: string) {
    if (typeof checkoutSessionId !== "string" || !/^[A-Za-z0-9_-]{1,160}$/.test(checkoutSessionId) || await this.binding.parent(merchantId, checkoutSessionId) !== conversationId) throw new ForbiddenException("attribution_session_forbidden");
    return this.attribution.bindSession(merchantId, conversationId, checkoutSessionId);
  }
  @Post("attribution") @Header("Cache-Control", "no-store")
  async capture(@Req() request: Request, @Param("conversationId") conversationId: string, @Body() body: unknown) {
    const claims = this.access(request, conversationId); const input = bodyFields<{ token: string; consent: boolean; consentVersion: string; fbc?: string; fbp?: string }>(body, ["token", "consent", "consentVersion", "fbc", "fbp"]);
    const receipt = await this.attribution.captureStore(claims.merchantId, { ...input, sessionId: conversationId, clientUserAgent: request.headers?.["user-agent"] ?? null });
    return { receiptId: receipt.id, campaignId: receipt.campaignId };
  }
  @Post("bind") @Header("Cache-Control", "no-store")
  async bind(@Req() request: Request, @Param("conversationId") conversationId: string, @Body() body: unknown) {
    const claims = this.access(request, conversationId); const input = bodyFields<{ checkoutSessionId: string }>(body, ["checkoutSessionId"]);
    return { bound: Boolean(await this.checkout(claims.merchantId, conversationId, input.checkoutSessionId)) };
  }
  @Post("revoke") @Header("Cache-Control", "no-store")
  async revoke(@Req() request: Request, @Param("conversationId") conversationId: string, @Body() body: unknown) {
    const claims = this.access(request, conversationId); bodyFields(body, []); await this.attribution.revoke(claims.merchantId, conversationId); return { revoked: true };
  }
  @Post("purchase") @Header("Cache-Control", "no-store")
  async purchase(@Req() request: Request, @Param("conversationId") conversationId: string, @Body() body: unknown, @Res() response: Response) {
    const claims = this.access(request, conversationId); const input = bodyFields<{ checkoutSessionId: string; orderId: string }>(body, ["checkoutSessionId", "orderId"]);
    await this.checkout(claims.merchantId, conversationId, input.checkoutSessionId);
    if (typeof input.orderId !== "string" || input.orderId.length > 200) throw new MetaAdsError("order_id_invalid");
    const fact = await this.service.commerce.paidOrder(claims.merchantId, input.orderId);
    if (!fact?.paid) return response.status(201).json(null);
    if (fact.merchantId !== claims.merchantId || fact.sessionId !== input.checkoutSessionId) throw new ForbiddenException("attribution_session_forbidden");
    await this.attribution.reconcilePurchase(claims.merchantId, fact.orderId);
    const signal = await this.attribution.browserPurchase(claims.merchantId, fact.sessionId, fact.orderId);
    if (!signal) return response.status(201).json(null);
    const state = await this.service.repo.read(claims.merchantId);
    return response.status(201).json({ eventId: signal.eventId, valueCents: signal.valueCents, currency: signal.currency, pixelId: state.connection.dataset?.id ?? null });
  }
}
