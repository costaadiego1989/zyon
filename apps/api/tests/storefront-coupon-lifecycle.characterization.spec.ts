import assert from "node:assert/strict";
import test from "node:test";
import type { Prisma } from "@prisma/client";
import type { Cart } from "@zyon/shared-types";
import { CouponEntity } from "../src/modules/coupons/domain/entities/coupon.entity.js";
import { CouponRedemptionEntity } from "../src/modules/coupons/domain/entities/coupon-redemption.entity.js";
import { createCouponEventEnvelope } from "../src/modules/coupons/domain/events/coupon-domain-event.js";
import { PrismaCouponTransactionRepository } from "../src/modules/coupons/infrastructure/repositories/prisma-coupon-transaction.repository.js";
import type { toRedemptionCreateInput } from "../src/modules/coupons/infrastructure/repositories/prisma-coupon.converters.js";
import { CheckoutBootstrapService } from "../src/modules/checkout/application/services/checkout-bootstrap.service.js";
import { InMemoryCheckoutRepository } from "../src/modules/checkout/infrastructure/repositories/in-memory-checkout.repository.js";
import { CouponsOnOrderCompletedHandler } from "../src/modules/coupons/infrastructure/event-handlers/on-order-completed.handler.js";
import { RedeemCouponUseCase } from "../src/modules/coupons/application/use-cases/redeem-coupon.use-case.js";
import { InMemoryDomainEventBus } from "../src/shared/events/in-memory-domain-event-bus.js";
import { InMemoryOutboxRepository } from "../src/shared/messaging/infrastructure/in-memory-outbox.repository.js";

// Source characterization ONLY. These delegates preserve the real Prisma
// repository's WHERE semantics but are not a DB, SQL, concurrency or payment proof.
// Do not register this intentionally RED regression in the global runner yet.
type Row = ReturnType<typeof toRedemptionCreateInput> & { createdAt: Date; updatedAt: Date };
type Scope = { merchantId: string; sessionId: string; couponId: string };
type ReadScope = { merchantId: string; sessionId: string; status: string; id?: { in: string[] }; couponId?: { in: string[] } };
const merchantId = "synthetic-lifecycle-merchant", cartId = "synthetic-lifecycle-cart";

function persistence() {
  let row: Row | undefined, usages = 0;
  const events: Array<{ eventType: string }> = [], reads: ReadScope[] = [];
  const tx = {
    async $queryRaw(parts: TemplateStringsArray, ...values: unknown[]) {
      if (parts.join('').includes('"max_usages"')) return [{ maxUsages: 1, maxPerBuyer: null, strategyIncentiveExecutionId: null }];
      assert.match(parts.join(''), /SELECT "id" FROM "coupons"[\s\S]+FOR UPDATE/);
      return row && row.couponId === values[0] && row.merchantId === values[1] ? [{ id: row.couponId }] : [];
    },
    couponRedemption: {
      async findUnique({ where }: { where: { merchantId_sessionId_couponId: Scope } }) {
        const scope = where.merchantId_sessionId_couponId;
        return row && row.merchantId === scope.merchantId && row.sessionId === scope.sessionId && row.couponId === scope.couponId ? row : null;
      },
      async count({ where }: { where: { couponId: string; buyerGlobalUserId?: string; status: { not: string } } }) {
        return Number(Boolean(row && row.couponId === where.couponId && row.status !== where.status.not
          && (where.buyerGlobalUserId === undefined || row.buyerGlobalUserId === where.buyerGlobalUserId)));
      },
      async create({ data }: { data: ReturnType<typeof toRedemptionCreateInput> }) {
        assert.equal(row, undefined, "fixture must not silently replace a reservation");
        row = { ...data, createdAt: new Date(0), updatedAt: new Date(0) }; return row;
      },
      async findMany({ where, select }: { where: ReadScope; select?: { id: boolean; couponId: boolean } }) {
        reads.push(structuredClone(where));
        const matches = row && row.merchantId === where.merchantId && row.sessionId === where.sessionId && row.status === where.status
          && (!where.id || where.id.in.includes(row.id)) && (!where.couponId || where.couponId.in.includes(row.couponId));
        return matches && row ? [select ? { id: row.id, couponId: row.couponId } : row] : [];
      },
      async updateMany({ where, data }: { where: Scope & { id: string; status: string }; data: { status: Row["status"]; orderId: string } }) {
        if (!row || row.id !== where.id || row.status !== where.status || row.merchantId !== where.merchantId
          || row.sessionId !== where.sessionId || row.couponId !== where.couponId) return { count: 0 };
        row = { ...row, ...data }; return { count: 1 };
      },
    },
    coupon: { async update({ where, data }: { where: { id: string }; data: { usagesCount: { increment: number } } }) {
      assert.equal(where.id, row?.couponId); usages += data.usagesCount.increment;
    } },
    outboxMessage: { async upsert({ create }: { create: { eventType: string } }) { events.push(create); return create; } },
  };
  return { transactions: new PrismaCouponTransactionRepository(tx as unknown as Prisma.TransactionClient, true),
    row: () => row, usages: () => usages, events, reads };
}

for (const sharedId of [true, false]) {
  test(`real reserve/bootstrap/completion ${sharedId ? "preserves direct same-session compatibility" : "must redeem storefront reservation through the generated checkout identity"}`, async () => {
    const store = persistence();
    const coupon = CouponEntity.create({ merchant_id: merchantId, code: "SAVE10", discount_type: "percent", discount_value: 10,
      min_cart_total: null, max_usages: 1, max_per_buyer: null, allowed_skus: [], blocked_skus: [], allowed_regions: [], blocked_regions: [],
      starts_at: new Date(0).toISOString(), ends_at: null });
    const redemption = CouponRedemptionEntity.create({ coupon_id: coupon.id, merchant_id: merchantId, session_id: cartId,
      buyer_global_user_id: "synthetic-buyer", discount_applied: 10, source: "manual" });
    assert.deepEqual(await store.transactions.reserve({ coupon: coupon.snapshot(), redemption,
      event: createCouponEventEnvelope({ eventType: "coupon.applied", merchantId, payload: { session_id: cartId } }),
    }), { status: "reserved", redemption_id: redemption.id });
    assert.equal(store.row()?.sessionId, cartId); assert.equal(store.row()?.status, "applied");

    // This cart is already authority-validated, as StartCheckoutUseCase passes it
    // into bootstrap. No fake changes the generated session ID or maps aliases.
    const cart: Cart = { cart_ref: cartId, source: "storefront", currency: "BRL", total: 100, currentDiscount: 10,
      items: [{ sku: "SKU", name: "Synthetic item", price: 100, quantity: 1 }] };
    const sessions = new InMemoryCheckoutRepository();
    const bootstrap = new CheckoutBootstrapService(sessions, new InMemoryOutboxRepository());
    const { session } = await bootstrap.bootstrap({ merchant_id: merchantId, cart,
      ...(sharedId ? { session_id: cartId } : {}) }, "synthetic-buyer", true);
    assert.equal(session.cart.cart_ref, cartId);
    assert.equal(session.cart.currentDiscount, 10);
    if (sharedId) assert.equal(session.sessionId, cartId);
    else { assert.match(session.sessionId, /^chk_/); assert.notEqual(session.sessionId, cartId); }

    const bus = new InMemoryDomainEventBus();
    new CouponsOnOrderCompletedHandler(bus, new RedeemCouponUseCase(store.transactions), new InMemoryOutboxRepository()).onModuleInit();
    // Same identifiers as CompleteOrderUseCase's actual order.completed payload;
    // direct publishing does NOT claim an order/payment was created in this test.
    const event = { eventType: "order.completed", merchantId,
      payload: { session_id: session.sessionId, external_order_id: "synthetic-order" } };
    await bus.publish(event);
    const scopedRead = { merchantId, sessionId: session.sessionId, status: "applied" };
    assert.deepEqual(store.reads, sharedId ? [scopedRead, { ...scopedRead, id: { in: [redemption.id] }, couponId: { in: [coupon.id] } }] : [scopedRead]);
    assert.equal(store.row()?.status, "redeemed", "paid checkout must redeem the original storefront reservation, not silently miss cartId");
    assert.equal(store.row()?.orderId, "synthetic-order");
    assert.equal(store.usages(), 1);
    assert.deepEqual(store.events.map(event => event.eventType), ["coupon.applied", "coupon.redeemed"]);
    await bus.publish(event);
    assert.equal(store.usages(), 1);
    assert.equal(store.events.filter(event => event.eventType === "coupon.redeemed").length, 1);
  });
}
