import { Injectable, Inject, NotFoundException, BadRequestException, UnprocessableEntityException, Optional } from "@nestjs/common";
import type { Cart, CartItem, ChatTurn, CheckoutSession } from "@zyon/shared-types";
import { CHECKOUT_SESSION_REPOSITORY, type CheckoutSessionRepository } from "../../../checkout/domain/ports/checkout-session.repository.port.js";
import { MERCHANT_REPOSITORY, type MerchantRepository } from "../../../merchant/domain/ports/merchant-repository.port.js";
import type { ProductRepositoryPort } from "../../../catalog/domain/ports/product-repository.port.js";
import { AcceptCrossSellSuggestionUseCase } from "./accept-cross-sell-suggestion.use-case.js";
import { buildExperienceFromSession } from "../../../checkout/application/services/checkout-experience.service.js";
import { resolveCrossSellCartItem } from "../services/cross-sell-product-resolver.js";
import { CorrelationIdStorage } from "../../../../shared/logger/correlation-id.storage.js";

@Injectable()
export class AcceptCrossSellFromWidgetUseCase {
  constructor(
    private readonly accept: AcceptCrossSellSuggestionUseCase,
    @Inject(CHECKOUT_SESSION_REPOSITORY) private readonly sessions: CheckoutSessionRepository,
    @Inject(MERCHANT_REPOSITORY) private readonly merchants: MerchantRepository,
    @Optional() @Inject("ProductRepositoryPort") private readonly productRepo?: ProductRepositoryPort
  ) {}

  async execute(input: {
    suggestion_id: string;
    merchant_id: string;
    session_id: string;
    accepted_skus: string[];
  }) {
    if (!input.suggestion_id || !input.session_id || !input.accepted_skus.length) {
      throw new BadRequestException("cross_sell_accept_payload_required");
    }

    const session = await this.sessions.getSession(input.merchant_id, input.session_id);
    if (!session) throw new NotFoundException("checkout_session_not_found");

    const rules = await this.merchants.getRules(input.merchant_id);

    const cart: Cart = { ...session.cart };
    if (cart.total == null) {
      cart.total = cart.items.reduce(
        (sum, i) => sum + ((i.price ?? (i as any).unit_price) || 0) * (i.quantity ?? 1),
        0
      );
    }

    const crossSellItems = await this.resolveCrossSellItems(input.merchant_id, input.accepted_skus);

    const suggestion = await this.accept.execute({
      suggestion_id: input.suggestion_id,
      merchant_id: input.merchant_id,
      session_id: input.session_id,
      accepted_skus: input.accepted_skus,
      cart,
      merchantRules: rules
    });

    const next = this.addCrossSellItems(session, crossSellItems);
    await this.sessions.saveSession(next);

    const agentTurn: ChatTurn = {
      role: "agent",
      text: "Perfeito, adicionei o complemento ao seu pedido. Agora vamos seguir para o cupom antes do pagamento.",
      occurredAt: new Date().toISOString()
    };
    const updated = await this.sessions.appendChatTurn(input.merchant_id, input.session_id, agentTurn);
    const merchant = await this.merchants.getProfile(input.merchant_id);

    const cartTotal = next.cart.total ?? this.roundCartTotal(next.cart.items);

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

  private async resolveCrossSellItems(merchantId: string, skus: string[]): Promise<CartItem[]> {
    if (!this.productRepo) {
      throw new UnprocessableEntityException("cross_sell_catalog_unavailable");
    }

    const items = await Promise.all(
      skus.map((sku) => resolveCrossSellCartItem(sku.trim(), this.productRepo!, merchantId)),
    );
    if (items.some((item) => item === null)) {
      throw new UnprocessableEntityException("cross_sell_product_unavailable");
    }
    return items as CartItem[];
  }

  private addCrossSellItems(session: CheckoutSession, crossSellItems: CartItem[]): CheckoutSession {
    const items = [...session.cart.items];
    for (const item of crossSellItems) {
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
        total: this.roundCartTotal(items)
      },
      updatedAt: new Date().toISOString()
    };
  }

  private roundCartTotal(items: CartItem[]): number {
    return Math.round(items.reduce((sum, item) => sum + item.price * item.quantity, 0) * 100) / 100;
  }
}
