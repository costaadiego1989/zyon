import { BadRequestException, Body, Controller, ForbiddenException, Inject, Param, Post, Req, UnauthorizedException } from "@nestjs/common";
import { OpenAIRealtimeVoiceService } from "../../../../shared/openai/openai-realtime-voice.service.js";
import { RealtimeCapabilityService } from "../../../../shared/auth/realtime-capability.js";
import { BillingPlanMeteringService } from "../../../payment/infrastructure/billing/billing-plan-guard.js";
import { STOREFRONT_CART_PORT, type StorefrontCartPort } from "../../domain/ports/storefront-cart.port.js";
import { findMerchantAgentRule } from "../../../agent-rules/infrastructure/find-merchant-agent-rule.js";
import { PRISMA_CLIENT } from "../../../../shared/persistence/persistence.module.js";
import type { PrismaClient } from "@prisma/client";

type VoiceRequest = { headers?: { authorization?: string; origin?: string } };
type ProductNarrationRequest = { summary?: unknown };

/** Issues an ephemeral voice credential only after conversation and plan verification. */
@Controller("storefront/conversations")
export class StorefrontRealtimeVoiceController {
  constructor(
    @Inject(RealtimeCapabilityService) private readonly capabilities: RealtimeCapabilityService,
    @Inject(STOREFRONT_CART_PORT) private readonly carts: StorefrontCartPort,
    @Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient,
    private readonly billing: BillingPlanMeteringService,
    private readonly realtime: OpenAIRealtimeVoiceService,
  ) {}

  @Post(":conversationId/realtime/session")
  async createSession(@Req() request: VoiceRequest, @Param("conversationId") conversationId: string) {
    const claims = this.verifyConversation(request, conversationId);

    await this.billing.assertAllowed(claims.merchantId, { kind: "feature", key: "voiceCheckout" });
    const cart = await this.carts.getOrCreate(claims.merchantId, claims.resourceId);
    let identity: { agentName?: string; greeting?: string } | undefined;
    try {
      const agentRule = await findMerchantAgentRule(this.prisma, claims.merchantId);
      const value = agentRule?.identity as { agentName?: unknown; greeting?: unknown } | null;
      if (value) {
        identity = {
          ...(typeof value.agentName === "string" ? { agentName: value.agentName } : {}),
          ...(typeof value.greeting === "string" ? { greeting: value.greeting } : {}),
        };
      }
    } catch { /* The standard voice greeting remains available without optional identity data. */ }
    return this.realtime.createClientSecret({
      merchantId: claims.merchantId,
      conversationId: claims.resourceId,
      ...(identity?.agentName ? { agentName: identity.agentName } : {}),
      ...(identity?.greeting ? { greeting: identity.greeting } : {}),
      cart: {
        items: cart.items.map((item) => ({ name: item.name, quantity: item.quantity, unitPrice: item.unitPriceCents / 100, variant: item.sku })),
        total: (cart.total - cart.discount) / 100,
        currency: "BRL",
      },
    });
  }

  /**
   * Product narration is intentionally a different session from purchase
   * voice: it has no microphone, cart context or commerce tools.
   */
  @Post(":conversationId/realtime/narration")
  async createProductNarration(
    @Req() request: VoiceRequest,
    @Param("conversationId") conversationId: string,
    @Body() body: ProductNarrationRequest,
  ) {
    const claims = this.verifyConversation(request, conversationId);
    const summary = typeof body?.summary === "string"
      ? body.summary.replace(/\s+/g, " ").trim().slice(0, 1_200)
      : "";
    if (!summary) throw new BadRequestException("product_summary_required");
    await this.billing.assertAllowed(claims.merchantId, { kind: "feature", key: "voiceCheckout" });
    return this.realtime.createProductNarrationClientSecret({
      merchantId: claims.merchantId,
      conversationId: claims.resourceId,
      summary,
    });
  }

  private verifyConversation(request: VoiceRequest, conversationId: string) {
    const token = request.headers?.authorization?.match(/^Bearer (\S+)$/i)?.[1];
    let claims;
    try { claims = this.capabilities.verify(token, "storefront-conversation", request.headers?.origin); }
    catch { throw new UnauthorizedException("invalid_conversation_token"); }
    if (claims.resourceId !== conversationId) throw new ForbiddenException("conversation_access_denied");
    return claims;
  }
}
