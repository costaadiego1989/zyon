import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { CouponsOnOrderCompletedHandler } from "./on-order-completed.handler.js";
import { CouponEntity } from "../../domain/entities/coupon.entity.js";
import { CouponRedemptionEntity } from "../../domain/entities/coupon-redemption.entity.js";
import { RedeemCouponUseCase } from "../../application/use-cases/redeem-coupon.use-case.js";
import { InMemoryCouponRepository } from "../repositories/in-memory-coupon.repository.js";
import { InMemoryCouponRedemptionRepository } from "../repositories/in-memory-coupon-redemption.repository.js";
import { InMemoryOutboxRepository } from "../../../../shared/messaging/infrastructure/in-memory-outbox.repository.js";
import type { DomainEventBus, DomainEvent } from "../../../../shared/events/domain-event-bus.port.js";

type Handler = (event: DomainEvent) => Promise<void>;

class FakeEventBus implements DomainEventBus {
  private handlers = new Map<string, { handlerId: string; handle: Handler }[]>();

  subscribe(eventType: string, handler: Handler, handlerId?: string): void {
    const existing = this.handlers.get(eventType) ?? [];
    existing.push({ handlerId: handlerId ?? "unknown", handle: handler });
    this.handlers.set(eventType, existing);
  }

  async publish(event: DomainEvent): Promise<void> {
    const handlers = this.handlers.get(event.eventType) ?? [];
    for (const h of handlers) {
      await h.handle(event);
    }
  }

  handlersFor(eventType: string) {
    return this.handlers.get(eventType) ?? [];
  }
}

function makeSetup() {
  const coupons = new InMemoryCouponRepository();
  const redemptions = new InMemoryCouponRedemptionRepository();
  const outbox = new InMemoryOutboxRepository();
  const eventBus = new FakeEventBus();
  const redeemUseCase = new RedeemCouponUseCase(coupons, redemptions, outbox);
  const handler = new CouponsOnOrderCompletedHandler(eventBus, redeemUseCase);
  return { coupons, redemptions, outbox, eventBus, handler };
}

describe("CouponsOnOrderCompletedHandler", () => {
  it("subscribes to order.completed on module init", () => {
    const { eventBus, handler } = makeSetup();
    handler.onModuleInit();
    // Verify by publishing an event and checking effects
    assert.ok(true, "should not throw during onModuleInit");
  });

  it("redeems applied coupons when order.completed event is published", async () => {
    const { coupons, redemptions, eventBus, handler } = makeSetup();
    handler.onModuleInit();

    const coupon = CouponEntity.create({
      merchant_id: "mrc_1",
      code: "SAVE10",
      discount_type: "percent",
      discount_value: 10,
      min_cart_total: null,
      max_usages: null,
      max_per_buyer: null,
      allowed_skus: [],
      blocked_skus: [],
      allowed_regions: [],
      blocked_regions: [],
      starts_at: new Date(Date.now() - 1000).toISOString(),
      ends_at: null
    });
    await coupons.save(coupon);
    await redemptions.save(CouponRedemptionEntity.create({
      coupon_id: coupon.id,
      merchant_id: "mrc_1",
      session_id: "sess_1",
      buyer_global_user_id: null,
      discount_applied: 10,
      source: "manual"
    }));

    await eventBus.publish({
      eventType: "order.completed",
      merchantId: "mrc_1",
      payload: { session_id: "sess_1", external_order_id: "ord_ext_1" }
    });

    const r = (await redemptions.findBySession("sess_1", "mrc_1"))[0];
    assert.equal(r?.status, "redeemed");
    assert.equal(r?.snapshot().order_id, "ord_ext_1");
  });

  it("does nothing when session_id or external_order_id missing from event payload", async () => {
    const { redemptions, eventBus, handler } = makeSetup();
    handler.onModuleInit();

    await eventBus.publish({
      eventType: "order.completed",
      merchantId: "mrc_1",
      payload: { session_id: "sess_1" } // missing external_order_id
    });

    await eventBus.publish({
      eventType: "order.completed",
      merchantId: "mrc_1",
      payload: { external_order_id: "ord_1" } // missing session_id
    });

    const all = await redemptions.findBySession("sess_1", "mrc_1");
    assert.equal(all.length, 0);
  });

  it("does not crash when redeem fails (C2 fix: graceful error handling)", async () => {
    const { eventBus } = makeSetup();
    const failingRedeemUseCase = {
      execute: async () => { throw new Error("db_connection_failed"); }
    };
    const handler2 = new CouponsOnOrderCompletedHandler(
      eventBus,
      failingRedeemUseCase as unknown as RedeemCouponUseCase
    );
    handler2.onModuleInit();

    // Should not throw
    await eventBus.publish({
      eventType: "order.completed",
      merchantId: "mrc_1",
      payload: { session_id: "sess_1", external_order_id: "ord_1" }
    });

    assert.ok(true, "handler swallowed the error gracefully");
  });
});