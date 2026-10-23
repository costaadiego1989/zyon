import { BadRequestException, Body, Controller, ForbiddenException, Inject, NotFoundException, Optional, Param, Post, Req, ServiceUnavailableException, UnauthorizedException } from "@nestjs/common";
import { OpenAIRealtimeVoiceService } from "../../../../shared/openai/openai-realtime-voice.service.js";
import { RealtimeCapabilityService } from "../../../../shared/auth/realtime-capability.js";
import { BILLING_PLAN_ACCESS, type BillingPlanAccessPort } from "../../../payment/domain/ports/billing-plan-access.port.js";
import { STOREFRONT_CART_PORT, type StorefrontCartPort } from "../../domain/ports/storefront-cart.port.js";
import { MERCHANT_AGENT_RULE_READER, type MerchantAgentRuleReaderPort } from "../../../agent-rules/domain/ports/merchant-agent-rule-reader.port.js";
import { AiUserIdentityService } from "../../../../shared/http/ai-user-identity.service.js";
import { STOREFRONT_CONVERSATION_SCOPE, type StorefrontConversationScopePort } from "../../domain/ports/conversation-scope.port.js";
import { isStorefrontDomainAllowed, STOREFRONT_OUT_OF_SCOPE_MESSAGE, STOREFRONT_SCOPE_CLARIFICATION_MESSAGE } from "../../domain/services/storefront-conversation-scope.js";
import { PRISMA_CLIENT } from "../../../../shared/persistence/persistence.module.js";
import type { PrismaClient } from "@prisma/client";
import { buildCanonicalProductNarration, canonicalNarrationProductSchema,
  storefrontProductNarrationRequestSchema, storefrontProductNarrationResponseSchema } from "../../domain/contracts/storefront-product-narration.schemas.js";

type VoiceRequest = { headers?: { authorization?: string; origin?: string; "x-buyer-authorization"?: string } };
type ProductNarrationRequest = { productId?: unknown; summary?: unknown; sdp?: unknown };

/** Issues an ephemeral voice credential only after conversation and plan verification. */
@Controller("storefront/conversations")
export class StorefrontRealtimeVoiceController {
  constructor(
    @Inject(RealtimeCapabilityService) private readonly capabilities: RealtimeCapabilityService,
    @Inject(STOREFRONT_CART_PORT) private readonly carts: StorefrontCartPort,
    @Inject(MERCHANT_AGENT_RULE_READER) private readonly agentRules: MerchantAgentRuleReaderPort,
    @Inject(BILLING_PLAN_ACCESS) private readonly billing: BillingPlanAccessPort,
    private readonly realtime: OpenAIRealtimeVoiceService,
    @Optional() @Inject(STOREFRONT_CONVERSATION_SCOPE) private readonly scope?: StorefrontConversationScopePort,
    @Optional() @Inject(PRISMA_CLIENT) private readonly prisma?: PrismaClient,
  ) {}

  @Post(":conversationId/realtime/session")
  async createSession(@Req() request: VoiceRequest, @Param("conversationId") conversationId: string, @Body() body: { sdp?: unknown }) {
    const sdp = voiceSdp(body?.sdp);
    const claims = this.verifyConversation(request, conversationId);
    const scope = this.scope;
    if (!scope) throw new ServiceUnavailableException("voice_scope_checker_required");

    await this.billing.assertAllowed(claims.merchantId, { kind: "feature", key: "voiceCheckout" });
    const cart = await this.carts.getOrCreate(claims.merchantId, claims.resourceId);
    let identity: { agentName?: string; greeting?: string } | undefined;
    try {
      const agentRule = await this.agentRules.findForMerchant(claims.merchantId);
      const value = agentRule?.identity as { agentName?: unknown; greeting?: unknown } | null;
      if (value) {
        identity = {
          ...(typeof value.agentName === "string" ? { agentName: value.agentName } : {}),
          ...(typeof value.greeting === "string" ? { greeting: value.greeting } : {}),
        };
      }
    } catch { /* The standard voice greeting remains available without optional identity data. */ }
    return this.realtime.createCall({
      surface: "storefront",
      checkScope: async input => {
        const domain = await scope.classifyConversationScope(input);
        return isStorefrontDomainAllowed(domain) ? { allowed: true } : {
          allowed: false, reason: domain === "OUT_OF_SCOPE" ? "out_of_scope" : "scope_unclear",
          message: domain === "OUT_OF_SCOPE" ? STOREFRONT_OUT_OF_SCOPE_MESSAGE : STOREFRONT_SCOPE_CLARIFICATION_MESSAGE,
        };
      },
      sdp, aiUserId: this.userId(request, claims), origin: request.headers?.origin,
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
    const parsed = storefrontProductNarrationRequestSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException("invalid_product_narration_input");
    const aiUserId = this.userId(request, claims);
    await this.billing.assertAllowed(claims.merchantId, { kind: "feature", key: "voiceCheckout" });
    if (!this.prisma) throw new ServiceUnavailableException("product_narration_catalog_unavailable");
    const product = canonicalNarrationProductSchema.safeParse(await this.prisma.product.findFirst({
      where: { id: parsed.data.productId, merchantId: claims.merchantId, isActive: true, deletedAt: null },
      select: { id: true, merchantId: true, name: true, description: true, isActive: true, deletedAt: true },
    }));
    if (!product.success || product.data.merchantId !== claims.merchantId || product.data.id !== parsed.data.productId) {
      throw new NotFoundException("product_narration_unavailable");
    }
    const narration = buildCanonicalProductNarration(product.data);
    if (!narration) throw new NotFoundException("product_narration_unavailable");
    const response = await this.realtime.createProductNarrationCall({
      sdp: parsed.data.sdp, aiUserId, origin: request.headers?.origin,
      merchantId: claims.merchantId,
      conversationId: claims.resourceId,
      summary: narration.script,
    });
    const output = storefrontProductNarrationResponseSchema.safeParse(response);
    if (!output.success) throw new ServiceUnavailableException("product_narration_invalid_response");
    return output.data;
  }

  private userId(request: VoiceRequest, claims: { merchantId: string; aiUserId?: string }) {
    const buyerToken = request.headers?.["x-buyer-authorization"]?.match(/^Bearer (\S+)$/i)?.[1];
    const userId = buyerToken ? new AiUserIdentityService().resolve({ buyerToken, merchantId: claims.merchantId }).userId : claims.aiUserId;
    if (!userId) throw new UnauthorizedException("ai_user_identity_required");
    return userId;
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

function voiceSdp(value: unknown): string {
  if (typeof value !== "string" || value.length > 200_000 || !value.trim().startsWith("v=0")) throw new BadRequestException("voice_sdp_offer_required");
  return value.trim();
}
