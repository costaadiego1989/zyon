import { BadRequestException, Body, Controller, Post, Req, UnauthorizedException, UseGuards } from "@nestjs/common";
import type { CheckoutSession } from "@zyon/shared-types";
import { OpenAIRealtimeVoiceService } from "../../../../shared/openai/openai-realtime-voice.service.js";
import { BillingPlanMeteringService } from "../../../payment/infrastructure/billing/billing-plan-guard.js";
import { EmbedAuthGuard } from "./embed-auth.guard.js";
import { RequireEmbedScope } from "./embed-scope.decorator.js";
import { EmbedCheckoutGuardHelper, type EmbedHttpRequest } from "./embed-checkout.controller.js";

@UseGuards(EmbedAuthGuard)
@Controller("embed/realtime")
export class EmbedRealtimeVoiceController {
  constructor(
    private readonly checkoutGuards: EmbedCheckoutGuardHelper,
    private readonly billing: BillingPlanMeteringService,
    private readonly realtime: OpenAIRealtimeVoiceService,
  ) {}

  @Post("session")
  @RequireEmbedScope("checkout:chat")
  async createSession(@Req() request: EmbedHttpRequest, @Body() body: { session_id?: unknown }) {
    if (typeof body.session_id !== "string" || !body.session_id.trim()) throw new BadRequestException("session_id_required");
    const embed = request.embedClaims!;
    const sessionId = body.session_id.trim();
    await this.checkoutGuards.assertSessionBelongsToEmbedMerchant(embed, sessionId);
    const session = await this.checkoutGuards.loadSession(embed.merchantId, sessionId);
    if (!session) throw new UnauthorizedException("embed_unknown_checkout_session");
    await this.billing.assertAllowed(embed.merchantId, { kind: "feature", key: "voiceCheckout" });
    return this.realtime.createClientSecret({ merchantId: embed.merchantId, conversationId: sessionId, cart: checkoutCartContext(session) });
  }
}

function checkoutCartContext(session: CheckoutSession) {
  return {
    items: session.cart.items.map((item) => ({ name: item.name, quantity: item.quantity, unitPrice: item.price, variant: item.variant })),
    total: session.cart.total,
    currency: session.cart.currency,
    shipping: session.shipping ? { carrier: session.shipping.carrier, method: session.shipping.method, customerPrice: session.shipping.customerPrice, deliveryDays: session.shipping.deliveryDays } : undefined,
  };
}
