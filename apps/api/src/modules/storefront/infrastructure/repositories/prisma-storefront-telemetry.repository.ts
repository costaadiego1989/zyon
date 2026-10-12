import { Inject, Injectable } from "@nestjs/common";
import type { PrismaClient } from "@prisma/client";
import { PRISMA_CLIENT } from "../../../../shared/persistence/persistence.module.js";
import { CheckoutAbandonmentService } from "../../../checkout/domain/services/checkout-abandonment.service.js";
import type { CheckoutEventName } from "@zyon/shared-types";
import type {
  StorefrontLiveSession,
  StorefrontTelemetryEvent,
  StorefrontTelemetryPort,
} from "../../domain/ports/storefront-telemetry.port.js";
import { STOREFRONT_CART_PORT, type StorefrontCartPort } from "../../domain/ports/storefront-cart.port.js";

const FUNNEL_EVENTS = new Set([
  "checkout_started",
  "auth_phone_submitted", "auth_phone_verified", "auth_identity_confirmed",
  "auth_registration_completed", "login_completed", "product_viewed", "cart_viewed",
  "cross_sell_accepted", "cross_sell_added",
  "shipping_option_selected", "coupon_applied", "payment_method_selected",
  "idle_30_seconds", "exit_intent_detected", "checkout_abandoned",
]);

const SCORED_CHECKOUT_EVENTS = new Set<CheckoutEventName>([
  "checkout_started",
  "auth_phone_submitted", "auth_phone_verified", "auth_identity_confirmed",
  "auth_registration_completed", "login_completed", "product_viewed", "cart_viewed",
  "cross_sell_accepted", "cross_sell_added", "shipping_option_selected", "coupon_applied",
  "payment_method_selected", "idle_30_seconds", "exit_intent_detected", "checkout_abandoned",
]);

const PRESERVES_LAST_ACTIVITY = new Set(["idle_30_seconds", "checkout_abandoned"]);

const EXPERIMENT_STAGE_UPDATES: Record<string, Record<string, unknown>> = {
  conversation_started: { conversationStarted: true },
  product_viewed: { cartViewed: true },
  add_to_cart: { cartViewed: true, cartItemsAdded: { increment: 1 } },
  checkout_intent: { checkoutStarted: true },
  auth_phone_submitted: { checkoutStarted: true },
  auth_phone_verified: { checkoutStarted: true },
  auth_identity_confirmed: { checkoutStarted: true },
  auth_registration_completed: { checkoutCompleted: true },
  purchase_completed: { converted: true, checkoutCompleted: true },
};

@Injectable()
export class PrismaStorefrontTelemetryRepository implements StorefrontTelemetryPort {
  constructor(
    @Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient,
    @Inject(STOREFRONT_CART_PORT) private readonly carts: StorefrontCartPort,
  ) {}

  async recordEvent(input: StorefrontTelemetryEvent): Promise<void> {
    const { merchantId, conversationId, event, metadata } = input;
    if (FUNNEL_EVENTS.has(event)) {
      const cart = await this.carts.getOrCreate(merchantId, input.cartId ?? conversationId);
      const recoveryCart = {
        items: cart.items,
        couponCode: cart.couponCode,
        discount: cart.discount,
        freeShipping: cart.freeShipping,
        total: cart.total,
      };
      const now = new Date();
      const session = await this.prisma.checkoutSession.upsert({
        where: { merchantId_sessionId: { merchantId, sessionId: conversationId } },
        create: {
          merchantId, sessionId: conversationId, globalUserId: input.globalUserId ?? conversationId,
          conversationId, cart: recoveryCart as any, abandonmentScore: 0, triggerAgent: false,
          chatHistory: [], createdAt: now, updatedAt: now,
        },
        update: {
          cart: recoveryCart as any,
          ...(input.globalUserId ? { globalUserId: input.globalUserId } : {}),
          ...(PRESERVES_LAST_ACTIVITY.has(event) ? {} : { updatedAt: now }),
        },
      });
      const existing = await this.prisma.checkoutEvent.findFirst({
        where: { merchantId, sessionId: conversationId, eventName: event },
      });
      if (!existing) {
        await this.prisma.checkoutEvent.create({
          data: { merchantId, sessionId: conversationId, eventName: event, occurredAt: new Date(), metadata: metadata as any },
        });
        if (SCORED_CHECKOUT_EVENTS.has(event as CheckoutEventName)) {
          const score = CheckoutAbandonmentService.applyEvent(session.abandonmentScore, event as CheckoutEventName);
          await this.prisma.checkoutSession.update({
            where: { merchantId_sessionId: { merchantId, sessionId: conversationId } },
            data: {
              abandonmentScore: score.nextScore,
              triggerAgent: score.triggerAgent,
              ...(PRESERVES_LAST_ACTIVITY.has(event) ? {} : { updatedAt: now }),
            },
          });
        }
      }
    }

    const running = await this.prisma.promptExperiment.findFirst({
      where: { merchantId, status: "running" },
      include: { variants: true },
    });
    if (!running || running.variants.length === 0) return;

    const variantId = chooseVariant(running.variants, conversationId);
    const update = EXPERIMENT_STAGE_UPDATES[event];
    if (!variantId || !update) return;

    await (this.prisma as any).promptVariantResult.upsert({
      where: { variantId_sessionId: { variantId, sessionId: conversationId } },
      create: { variantId, sessionId: conversationId, converted: false, conversationStarted: true, ...update },
      update,
    });
  }

  async listLiveSessions(merchantId: string, since: Date): Promise<StorefrontLiveSession[]> {
    const sessions = await this.prisma.checkoutSession.findMany({
      where: { merchantId, updatedAt: { gte: since }, NOT: { sessionId: { startsWith: "chk_" } } },
      include: { events: { select: { eventName: true }, orderBy: { occurredAt: "desc" } } },
      orderBy: { updatedAt: "desc" },
      take: 50,
    });
    return sessions.map((session: any) => ({
      sessionId: session.sessionId,
      eventNames: session.events.map((event: { eventName: string }) => event.eventName),
      updatedAt: session.updatedAt,
      abandonmentScore: session.abandonmentScore ?? null,
    }));
  }
}

function chooseVariant(variants: Array<{ id: string; weight: number }>, conversationId: string): string | null {
  let hash = 0;
  for (let index = 0; index < conversationId.length; index++) {
    hash = ((hash << 5) - hash) + conversationId.charCodeAt(index);
    hash |= 0;
  }
  const totalWeight = variants.reduce((sum, variant) => sum + variant.weight, 0);
  if (totalWeight <= 0) return null;
  let target = (Math.abs(hash) % totalWeight) + 1;
  for (const variant of variants) {
    target -= variant.weight;
    if (target <= 0) return variant.id;
  }
  return null;
}
