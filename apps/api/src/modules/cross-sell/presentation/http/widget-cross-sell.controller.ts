import { BadRequestException, Body, Controller, Inject, NotFoundException, Post, Req, UseGuards } from "@nestjs/common";
import type { Cart, CartItem, ChatTurn, CheckoutSession } from "@zyon/shared-types";
import { ListEligibleCrossSellsUseCase } from "../../application/use-cases/list-eligible-cross-sells.use-case.js";
import { AcceptCrossSellSuggestionUseCase } from "../../application/use-cases/accept-cross-sell-suggestion.use-case.js";
import { DeclineCrossSellSuggestionUseCase } from "../../application/use-cases/decline-cross-sell-suggestion.use-case.js";
import { EmbedAuthGuard } from "../../../embed/presentation/http/embed-auth.guard.js";
import { EmbedCheckoutGuardHelper, type EmbedHttpRequest } from "../../../embed/presentation/http/embed-checkout.controller.js";
import { CHECKOUT_SESSION_REPOSITORY, type CheckoutSessionRepository } from "../../../checkout/domain/ports/checkout-session.repository.port.js";
import { MERCHANT_REPOSITORY, type MerchantRepository } from "../../../merchant/domain/ports/merchant-repository.port.js";
import { buildExperienceFromSession } from "../../../checkout/application/services/checkout-experience.service.js";
import { resolveCrossSellCartItem } from "../../application/services/cross-sell-product-resolver.js";

@UseGuards(EmbedAuthGuard)
@Controller("embed/cross-sell")
export class WidgetCrossSellController {
  constructor(
    private readonly listEligible: ListEligibleCrossSellsUseCase,
    private readonly accept: AcceptCrossSellSuggestionUseCase,
    private readonly decline: DeclineCrossSellSuggestionUseCase,
    private readonly embedGuards: EmbedCheckoutGuardHelper,
    @Inject(CHECKOUT_SESSION_REPOSITORY) private readonly sessions: CheckoutSessionRepository,
    @Inject(MERCHANT_REPOSITORY) private readonly merchants: MerchantRepository
  ) {}

  @Post("suggest")
  async suggest(@Req() request: EmbedHttpRequest, @Body() body: { session_id: string; cart: Cart; agent_copy?: string }) {
    const embed = request.embedClaims!;
    await this.embedGuards.assertSessionBelongsToEmbedMerchant(embed, body.session_id);
    return this.listEligible.execute({ ...body, merchant_id: embed.merchantId });
  }

  @Post("accept")
  async acceptSuggestion(
    @Req() request: EmbedHttpRequest,
    @Body() body: { suggestion_id: string; session_id: string; accepted_skus: string[] }
  ) {
    const embed = request.embedClaims!;
    if (!body.suggestion_id || !body.session_id || !Array.isArray(body.accepted_skus) || body.accepted_skus.length === 0) {
      throw new BadRequestException("cross_sell_accept_payload_required");
    }
    await this.embedGuards.assertSessionBelongsToEmbedMerchant(embed, body.session_id);

    const session = await this.sessions.getSession(embed.merchantId, body.session_id);
    if (!session) throw new NotFoundException("checkout_session_not_found");
    const rules = await this.merchants.getRules(embed.merchantId);

    const suggestion = await this.accept.execute({
      suggestion_id: body.suggestion_id,
      merchant_id: embed.merchantId,
      session_id: body.session_id,
      accepted_skus: body.accepted_skus,
      cart: session.cart,
      merchantRules: rules
    });

    const next = addCrossSellItems(session, body.accepted_skus);
    await this.sessions.saveSession(next);

    const agentTurn: ChatTurn = {
      role: "agent",
      text: "Perfeito, adicionei o complemento ao seu pedido. Agora vamos seguir para o cupom antes do pagamento.",
      occurredAt: new Date().toISOString()
    };
    const updated = await this.sessions.appendChatTurn(embed.merchantId, body.session_id, agentTurn);
    const merchant = await this.merchants.getProfile(embed.merchantId);

    // Ensure cart.total is computed if missing
    const cartTotal = next.cart.total ?? roundCartTotal(next.cart.items);

    return {
      suggestion,
      experience: buildExperienceFromSession(updated, {
        merchantName: merchant?.name,
        theme: merchant?.theme,
        couponBoxEnabled: rules.couponBoxEnabled,
        rules
      }),
      agent_turn: agentTurn,
      cart: {
        ...next.cart,
        total: cartTotal
      }
    };
  }

  @Post("decline")
  async declineSuggestion(@Req() request: EmbedHttpRequest, @Body() body: { suggestion_id: string; session_id: string }) {
    const embed = request.embedClaims!;
    await this.embedGuards.assertSessionBelongsToEmbedMerchant(embed, body.session_id);
    return this.decline.execute({ ...body, merchant_id: embed.merchantId });
  }
}

function addCrossSellItems(session: CheckoutSession, skus: string[]): CheckoutSession {
  const items = [...session.cart.items];
  for (const sku of skus.map((value) => value.trim()).filter(Boolean)) {
    const item = resolveCrossSellCartItem(sku);
    const existing = items.find((candidate) => candidate.sku === item.sku);
    if (existing) {
      existing.quantity += 1;
    } else {
      items.push(item);
    }
  }

  return {
    ...session,
    cart: {
      ...session.cart,
      items,
      total: roundCartTotal(items)
    },
    updatedAt: new Date().toISOString()
  };
}

function roundCartTotal(items: CartItem[]): number {
  return Math.round(items.reduce((sum, item) => sum + item.price * item.quantity, 0) * 100) / 100;
}
