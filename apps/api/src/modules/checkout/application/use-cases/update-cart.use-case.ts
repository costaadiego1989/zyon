import { BadRequestException, Inject, Injectable, NotFoundException, Optional } from "@nestjs/common";
import type { Cart, CartItem, CheckoutSession, UpdateCartRequest, UpdateCartResponse } from "@aacp/shared-types";
import { MERCHANT_REPOSITORY, type MerchantRepository } from "../../../merchant/domain/ports/merchant-repository.port.js";
import { AGENT_CONTEXT_PORT, type AgentContextPort } from "../../domain/ports/agent-context.port.js";
import { CHECKOUT_SESSION_REPOSITORY, type CheckoutSessionRepository } from "../../domain/ports/checkout-session.repository.port.js";
import { OUTBOX_REPOSITORY, type OutboxRepository } from "../../../../shared/messaging/ports/outbox.repository.port.js";
import { createCheckoutEventEnvelope } from "../../domain/events/checkout-domain-event.js";
import { buildExperienceFromSession } from "../services/checkout-experience.service.js";

const MAX_ITEM_QUANTITY = 99;

function roundCurrency(value: number): number {
  return Math.round(value * 100) / 100;
}

function recomputeTotal(items: CartItem[], currentDiscount: number): number {
  const subtotal = items.reduce((sum, item) => sum + item.price * item.quantity, 0);
  return Math.max(0, roundCurrency(subtotal - currentDiscount));
}

@Injectable()
export class UpdateCartUseCase {
  constructor(
    @Inject(CHECKOUT_SESSION_REPOSITORY) private readonly sessions: CheckoutSessionRepository,
    @Inject(OUTBOX_REPOSITORY) private readonly outbox: OutboxRepository,
    @Optional() @Inject(MERCHANT_REPOSITORY) private readonly merchants?: MerchantRepository,
    @Optional() @Inject(AGENT_CONTEXT_PORT) private readonly agentContext?: AgentContextPort
  ) {}

  async execute(input: UpdateCartRequest): Promise<UpdateCartResponse> {
    const merchantId = input.merchant_id?.trim();
    const sessionId = input.session_id?.trim();
    if (!merchantId || !sessionId) throw new BadRequestException("update_cart_scope_invalid");
    if (!Array.isArray(input.items) || input.items.length === 0) {
      throw new BadRequestException("update_cart_items_required");
    }

    const session = await this.sessions.getSession(merchantId, sessionId);
    if (!session) throw new NotFoundException("checkout_session_not_found");

    // Server is the price authority: requests only carry sku + quantity, never price.
    const bySku = new Map<string, CartItem>();
    for (const item of session.cart.items) bySku.set(item.sku, { ...item });

    for (const change of input.items) {
      const sku = change.sku?.trim();
      if (!sku) throw new BadRequestException("update_cart_sku_required");
      const quantity = change.quantity;
      if (!Number.isInteger(quantity) || quantity < 0 || quantity > MAX_ITEM_QUANTITY) {
        throw new BadRequestException("update_cart_quantity_invalid");
      }
      const existing = bySku.get(sku);
      if (!existing) throw new BadRequestException("update_cart_unknown_sku");
      if (quantity === 0) {
        bySku.delete(sku);
      } else {
        existing.quantity = quantity;
      }
    }

    const items = Array.from(bySku.values());
    const currentDiscount = session.cart.currentDiscount ?? 0;
    const nextCart: Cart = {
      ...session.cart,
      items,
      total: recomputeTotal(items, currentDiscount)
    };

    const cartChanged = JSON.stringify(nextCart.items) !== JSON.stringify(session.cart.items);
    // Cart mutation invalidates any prior freight quote; buyer must re-select shipping
    // so the payment amount stays consistent with the current cart.
    const nextSession: CheckoutSession = {
      ...session,
      cart: nextCart,
      shipping: cartChanged ? undefined : session.shipping,
      updatedAt: new Date().toISOString()
    };

    await this.sessions.saveSession(nextSession);

    if (cartChanged) {
      await this.outbox.appendOutbox(
        createCheckoutEventEnvelope({
          eventType: "checkout.cart.updated",
          merchantId,
          payload: {
            session_id: sessionId,
            currency: nextCart.currency,
            total: nextCart.total,
            item_count: items.reduce((sum, item) => sum + item.quantity, 0)
          },
          causationId: sessionId
        })
      );
    }

    const merchant = await this.merchants?.getProfile(merchantId);
    const rules = await this.merchants?.getRules(merchantId);
    const agent = await this.agentContext?.get({ merchantId, globalUserId: nextSession.globalUserId });

    return {
      session_id: sessionId,
      experience: buildExperienceFromSession(nextSession, {
        merchantName: merchant?.name,
        theme: merchant?.theme,
        agent,
        couponBoxEnabled: rules?.couponBoxEnabled,
        rules
      })
    };
  }
}
