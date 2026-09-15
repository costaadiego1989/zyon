import { Controller, ForbiddenException, Inject, Param, Post, Req, UnauthorizedException } from "@nestjs/common";
import { OpenAIRealtimeVoiceService } from "../../../../shared/openai/openai-realtime-voice.service.js";
import { RealtimeCapabilityService } from "../../../../shared/auth/realtime-capability.js";
import { BillingPlanMeteringService } from "../../../payment/infrastructure/billing/billing-plan-guard.js";
import { STOREFRONT_CART_PORT, type StorefrontCartPort } from "../../domain/ports/storefront-cart.port.js";

type VoiceRequest = { headers?: { authorization?: string; origin?: string } };

/** Issues an ephemeral voice credential only after conversation and plan verification. */
@Controller("storefront/conversations")
export class StorefrontRealtimeVoiceController {
  constructor(
    @Inject(RealtimeCapabilityService) private readonly capabilities: RealtimeCapabilityService,
    @Inject(STOREFRONT_CART_PORT) private readonly carts: StorefrontCartPort,
    private readonly billing: BillingPlanMeteringService,
    private readonly realtime: OpenAIRealtimeVoiceService,
  ) {}

  @Post(":conversationId/realtime/session")
  async createSession(@Req() request: VoiceRequest, @Param("conversationId") conversationId: string) {
    const token = request.headers?.authorization?.match(/^Bearer (\S+)$/i)?.[1];
    let claims;
    try { claims = this.capabilities.verify(token, "storefront-conversation", request.headers?.origin); }
    catch { throw new UnauthorizedException("invalid_conversation_token"); }
    if (claims.resourceId !== conversationId) throw new ForbiddenException("conversation_access_denied");

    await this.billing.assertAllowed(claims.merchantId, { kind: "feature", key: "voiceCheckout" });
    const cart = await this.carts.getOrCreate(claims.merchantId, claims.resourceId);
    return this.realtime.createClientSecret({
      merchantId: claims.merchantId,
      conversationId: claims.resourceId,
      cart: {
        items: cart.items.map((item) => ({ name: item.name, quantity: item.quantity, unitPrice: item.unitPriceCents / 100, variant: item.sku })),
        total: (cart.total - cart.discount) / 100,
        currency: "BRL",
      },
    });
  }
}
