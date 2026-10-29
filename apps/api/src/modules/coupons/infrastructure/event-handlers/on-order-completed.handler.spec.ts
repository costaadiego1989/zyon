import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { Logger } from "@nestjs/common";
import { CouponsOnOrderCompletedHandler } from "./on-order-completed.handler.js";
import { CouponEntity } from "../../domain/entities/coupon.entity.js";
import { CouponRedemptionEntity } from "../../domain/entities/coupon-redemption.entity.js";
import { RedeemCouponUseCase } from "../../application/use-cases/redeem-coupon.use-case.js";
import { InMemoryCouponRepository } from "../repositories/in-memory-coupon.repository.js";
import { InMemoryCouponRedemptionRepository } from "../repositories/in-memory-coupon-redemption.repository.js";
import { InMemoryCouponTransactionRepository } from "../repositories/in-memory-coupon-transaction.repository.js";
import { InMemoryOutboxRepository } from "../../../../shared/messaging/infrastructure/in-memory-outbox.repository.js";
import type { DomainEventBus, DomainEvent } from "../../../../shared/events/domain-event-bus.port.js";
import { InMemoryDomainEventBus } from "../../../../shared/events/in-memory-domain-event-bus.js";
import { OutboxDispatcher } from "../../../../shared/messaging/outbox-dispatcher.service.js";
import { OUTBOX_MAX_ATTEMPTS } from "../../../../shared/messaging/ports/outbox.repository.port.js";
import { createCheckoutEventEnvelope } from "../../../checkout/domain/events/checkout-domain-event.js";
import type { CouponTransactionRepository } from "../../domain/ports/coupon-transaction-repository.port.js";
import type { DomainEventEnvelope } from "@zyon/shared-types";
import { createHash } from "node:crypto";

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
  const transactions = new InMemoryCouponTransactionRepository(coupons, redemptions, outbox);
  const eventBus = new FakeEventBus();
  const redeemUseCase = new RedeemCouponUseCase(transactions);
  const handler = new CouponsOnOrderCompletedHandler(eventBus, redeemUseCase, outbox);
  return { coupons, redemptions, outbox, transactions, eventBus, handler };
}

const handlerId = "coupons.CouponsOnOrderCompletedHandler";
const childHandlerId = "coupons.CouponsOnOrderCompletedHandler.redemption-requested";
const sensitiveFailure = "synthetic-buyer@example.invalid coupon-private-payload";
const identity = { merchantId: "merchant_coupon_delivery", sessionId: "session_same_identity", orderId: "order_same_identity" };

/** Delivery double uses the existing lease/backoff implementation and only
 * virtualizes time. It is not PostgreSQL durability or transaction evidence. */
class DeliveryClockOutbox extends InMemoryOutboxRepository {
  private currentTime = Date.now();
  readonly failures: { eventId: string; attempt: number; code: string }[] = [];
  protected override now(): number { return this.currentTime; }
  advance(ms: number): void { this.currentTime += ms; }
  override failClaim(...args: Parameters<InMemoryOutboxRepository["failClaim"]>) {
    const [claim, code, nextAttemptAt] = args;
    this.failures.push({ eventId: claim.envelope.event_id, attempt: claim.attempts, code });
    return super.failClaim(claim, code, new Date(this.currentTime + Math.max(0, nextAttemptAt.getTime() - Date.now())));
  }
}

async function deliveryFixture(fault: "before" | "after" | "always") {
  const setup = makeSetup();
  const coupon = CouponEntity.create({ merchant_id: identity.merchantId, code: "DELIVERY10", discount_type: "percent",
    discount_value: 10, min_cart_total: null, max_usages: null, max_per_buyer: null,
    allowed_skus: [], blocked_skus: [], allowed_regions: [], blocked_regions: [],
    starts_at: "2026-01-01T00:00:00.000Z", ends_at: null });
  const redemption = CouponRedemptionEntity.create({ coupon_id: coupon.id, merchant_id: identity.merchantId,
    session_id: identity.sessionId, buyer_global_user_id: null, discount_applied: 10, source: "manual" });
  await setup.coupons.save(coupon);
  await setup.redemptions.save(redemption);
  const calls: typeof identity[] = [];
  // Explicit fault seam around the existing in-memory transaction double.
  // "after" models a lost acknowledgement after its local effect, not SQL COMMIT.
  const transactions: CouponTransactionRepository = {
    reserve: input => setup.transactions.reserve(input),
    redeem: async input => {
      calls.push({ merchantId: input.merchantId, sessionId: input.sessionId, orderId: input.orderId });
      if (fault === "always" || fault === "before" && calls.length <= 2) throw new Error(sensitiveFailure);
      await setup.transactions.redeem(input);
      if (fault === "after" && calls.length <= 2) throw new Error(sensitiveFailure);
    },
  };
  const bus = new InMemoryDomainEventBus();
  const delivery = new DeliveryClockOutbox();
  const enqueueCalls: DomainEventEnvelope[] = [];
  const enqueue = { appendOutbox: async (event: DomainEventEnvelope) => {
    enqueueCalls.push(structuredClone(event));
    return delivery.appendOutbox(event);
  } };
  new CouponsOnOrderCompletedHandler(bus, new RedeemCouponUseCase(transactions), enqueue).onModuleInit();
  const event = createCheckoutEventEnvelope({ eventType: "order.completed", merchantId: identity.merchantId,
    payload: { session_id: identity.sessionId, external_order_id: identity.orderId },
    correlationId: "correlation_same_identity", causationId: "payment_same_identity" });
  delivery.appendOutbox(event);
  return { ...setup, coupon, redemption, bus, delivery, event, calls, enqueue, enqueueCalls };
}

async function assertSingleLocalRedemption(f: Awaited<ReturnType<typeof deliveryFixture>>) {
  const redemptions = await f.redemptions.findBySession(identity.sessionId, identity.merchantId);
  assert.equal(redemptions.length, 1);
  assert.equal(redemptions[0].id, f.redemption.id);
  assert.equal(redemptions[0].status, "redeemed");
  assert.equal(redemptions[0].snapshot().order_id, identity.orderId);
  const coupon = await f.coupons.findById(f.coupon.id, identity.merchantId);
  assert.equal(coupon?.snapshot().usages_count, 1);
  const effects = f.outbox.listOutbox(identity.merchantId);
  assert.equal(effects.length, 1);
  assert.equal(effects[0].event_type, "coupon.redeemed");
  assert.equal(effects[0].merchant_id, identity.merchantId);
  assert.deepEqual(effects[0].payload, { session_id: identity.sessionId, coupon_id: f.coupon.id,
    order_id: identity.orderId, discount_applied: 10, buyer_global_user_id: "" });
}

describe("CouponsOnOrderCompletedHandler", () => {
  it("subscribes to order.completed on module init", () => {
    const { eventBus, handler } = makeSetup();
    handler.onModuleInit();
    const registrations = eventBus.handlersFor("order.completed");
    assert.equal(registrations.length, 1);
    assert.equal(registrations[0].handlerId, handlerId);
    assert.deepEqual(eventBus.handlersFor("coupon.redemption.requested").map(h => h.handlerId), [childHandlerId]);
    assert.equal(eventBus.handlersFor("coupon.redeemed").length, 0);
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

  for (const cause of [new Error(sensitiveFailure), sensitiveFailure, null, undefined,
    { toString() { throw new Error("failure_cause_must_not_be_inspected"); } }]) {
    it(`propagates only a fixed recoverable error without logging cause (${cause instanceof Error ? "Error" : typeof cause})`, async t => {
      const logs: unknown[][] = [];
      t.mock.method(Logger.prototype, "error", (...args: unknown[]) => { logs.push(args); });
      const { eventBus } = makeSetup();
      let calls = 0;
      const transactions: CouponTransactionRepository = {
        reserve: async () => { throw new Error("reserve_must_not_run"); },
        redeem: async input => {
          calls++;
          assert.deepEqual({ merchantId: input.merchantId, sessionId: input.sessionId, orderId: input.orderId }, identity);
          throw cause;
        },
      };
      let enqueues = 0;
      const enqueue = { appendOutbox: async () => { enqueues++; throw cause; } };
      new CouponsOnOrderCompletedHandler(eventBus, new RedeemCouponUseCase(transactions), enqueue).onModuleInit();
      await assert.rejects(eventBus.publish({ eventType: "order.completed", merchantId: identity.merchantId,
        payload: { session_id: identity.sessionId, external_order_id: identity.orderId } }), (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.equal(error.message, "coupon_redemption_failed");
        assert.equal(Object.hasOwn(error, "cause"), false);
        assert.equal(String(error.stack).includes(sensitiveFailure), false);
        return true;
      });
      assert.equal(calls, 1, "the subscriber must not retry locally");
      await assert.rejects(eventBus.publish({ eventType: "coupon.redemption.requested", merchantId: identity.merchantId,
        payload: { session_id: identity.sessionId, external_order_id: identity.orderId } }), (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.equal(error.message, "coupon_redemption_failed");
        assert.equal(Object.hasOwn(error, "cause"), false);
        assert.equal(String(error.stack).includes(sensitiveFailure), false);
        return true;
      });
      assert.equal(calls, 2);
      assert.equal(enqueues, 1, "child failures must not enqueue recursively");
      assert.deepEqual(logs, [], "no raw cause, stack or payload is logged by the subscriber");
    });
  }

  for (const fault of ["before", "after"] as const) {
    it("durable child isolates coupon failure from following order handlers (" + fault + ")", async t => {
      const f = await deliveryFixture(fault);
      const first = new OutboxDispatcher(f.delivery, f.bus, { concurrency: 1 });
      const restarted = new OutboxDispatcher(f.delivery, f.bus, { concurrency: 1 });
      t.after(async () => { await first.onModuleDestroy(); await restarted.onModuleDestroy(); });
      const received: DomainEvent[] = [];
      f.bus.subscribe("order.completed", async event => { received.push(event); }, "test.following-handler");
      await first.dispatch();
      assert.equal(received.length, 1, "durably queued coupon recovery must not block the following order handler");
      assert.equal(f.delivery.isProcessed(f.event.event_id), true);
      assert.equal(f.delivery.isHandlerProcessed(f.event.event_id, handlerId), true);
      const children = f.delivery.listOutbox(identity.merchantId).filter(event => event.event_type === "coupon.redemption.requested");
      assert.equal(children.length, 1);
      const child = children[0];
      const expectedId = "evt_coupon_redemption_retry_" + createHash("sha256")
        .update(JSON.stringify([identity.merchantId, identity.sessionId, identity.orderId])).digest("hex");
      assert.equal(child.event_id, expectedId);
      assert.equal(child.merchant_id, identity.merchantId);
      assert.equal(child.correlation_id, f.event.correlation_id);
      assert.equal(child.causation_id, f.event.event_id);
      assert.deepEqual(child.payload, { session_id: identity.sessionId, external_order_id: identity.orderId });
      assert.equal(f.delivery.isProcessed(child.event_id), false);
      assert.equal(f.delivery.isHandlerProcessed(child.event_id, childHandlerId), false);
      assert.deepEqual(f.delivery.failures, [{ eventId: child.event_id, attempt: 1, code: "outbox_handler_failed" }]);
      assert.equal(f.delivery.claimBatch().length, 0, "child obeys the existing backoff");
      assert.deepEqual(f.calls, [identity, identity]);
      assert.equal(f.enqueueCalls.length, 1, "the failing child must never enqueue another child");
      if (fault === "before") {
        assert.equal((await f.coupons.findById(f.coupon.id, identity.merchantId))?.snapshot().usages_count, 0);
        assert.equal((await f.redemptions.findBySession(identity.sessionId, identity.merchantId))[0].status, "applied");
        assert.equal(f.outbox.listOutbox(identity.merchantId).length, 0);
      } else await assertSingleLocalRedemption(f);
      await first.onModuleDestroy();
      f.delivery.advance(60_000);
      await restarted.dispatch();
      assert.equal(f.delivery.isProcessed(child.event_id), true);
      assert.equal(f.delivery.isHandlerProcessed(child.event_id, childHandlerId), true);
      assert.deepEqual(f.calls, [identity, identity, identity]);
      assert.equal(received.length, 1);
      await assertSingleLocalRedemption(f);
      const effects = f.outbox.listOutbox(identity.merchantId);
      f.delivery.advance(60_000);
      await restarted.dispatch();
      assert.equal(f.calls.length, 3);
      assert.equal(f.enqueueCalls.length, 1);
      assert.deepEqual(f.outbox.listOutbox(identity.merchantId), effects);
    });
  }

  it("child retry exhaustion does not replay or block the completed parent and never recursively enqueues", async t => {
    const f = await deliveryFixture("always");
    const dispatcher = new OutboxDispatcher(f.delivery, f.bus, { concurrency: 1 });
    t.after(() => dispatcher.onModuleDestroy());
    let following = 0;
    f.bus.subscribe("order.completed", async () => { following++; }, "test.following-handler");
    for (let attempt = 1; attempt <= OUTBOX_MAX_ATTEMPTS; attempt++) {
      await dispatcher.dispatch();
      assert.equal(following, 1);
      assert.equal(f.delivery.isProcessed(f.event.event_id), true);
      assert.equal(f.calls.length, attempt + 1, "one fastpath failure, then the existing child attempt budget");
      const children = f.delivery.listOutbox(identity.merchantId).filter(event => event.event_type === "coupon.redemption.requested");
      assert.equal(children.length, 1);
      assert.equal(f.delivery.isProcessed(children[0].event_id), false);
      assert.equal(f.delivery.isHandlerProcessed(children[0].event_id, childHandlerId), false);
      assert.deepEqual(f.delivery.failures.at(-1), { eventId: children[0].event_id, attempt, code: "outbox_handler_failed" });
      assert.equal(f.delivery.getBacklog().dead, attempt === OUTBOX_MAX_ATTEMPTS ? 1 : 0);
      assert.equal(f.enqueueCalls.length, 1);
      f.delivery.advance(60_000);
    }
    await dispatcher.dispatch();
    assert.equal(f.calls.length, OUTBOX_MAX_ATTEMPTS + 1);
    assert.equal(f.delivery.getBacklog().pending, 0);
    assert.equal(f.delivery.claimBatch().length, 0);
    assert.equal(f.outbox.listOutbox(identity.merchantId).length, 0);
    assert.equal((await f.coupons.findById(f.coupon.id, identity.merchantId))?.snapshot().usages_count, 0);
  });

  it("enqueue failure retains the parent for retry and does not acknowledge following handlers", async t => {
    const f = await deliveryFixture("always");
    const mocked = t.mock.method(f.enqueue, "appendOutbox", async () => { throw new Error(sensitiveFailure); });
    const dispatcher = new OutboxDispatcher(f.delivery, f.bus, { concurrency: 1 });
    t.after(() => dispatcher.onModuleDestroy());
    let following = 0;
    f.bus.subscribe("order.completed", async () => { following++; }, "test.following-handler");
    await dispatcher.dispatch();
    assert.equal(following, 0);
    assert.equal(f.delivery.isProcessed(f.event.event_id), false);
    assert.equal(f.delivery.isHandlerProcessed(f.event.event_id, handlerId), false);
    assert.equal(f.delivery.listOutbox(identity.merchantId).length, 1);
    assert.deepEqual(f.delivery.failures, [{ eventId: f.event.event_id, attempt: 1, code: "outbox_handler_failed" }]);
    mocked.mock.restore();
    f.delivery.advance(60_000);
    await dispatcher.dispatch();
    assert.equal(following, 1);
    assert.equal(f.delivery.isProcessed(f.event.event_id), true);
    assert.equal(f.delivery.listOutbox(identity.merchantId).filter(event => event.event_type === "coupon.redemption.requested").length, 1);
  });

  it("parent ACK waits for confirmed durable append, not merely starting enqueue", async t => {
    const f = await deliveryFixture("always");
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    let entered!: () => void;
    const appending = new Promise<void>(resolve => { entered = resolve; });
    t.mock.method(f.enqueue, "appendOutbox", async (event: DomainEventEnvelope) => {
      entered();
      await gate;
      return f.delivery.appendOutbox(event);
    });
    const dispatcher = new OutboxDispatcher(f.delivery, f.bus, { concurrency: 1 });
    t.after(async () => { release(); await dispatcher.onModuleDestroy(); });
    let following = 0;
    f.bus.subscribe("order.completed", async () => { following++; }, "test.following-handler");
    const active = dispatcher.dispatch();
    await Promise.race([appending, active.then(() => assert.fail("parent completed without attempting durable append"))]);
    try {
      assert.equal(following, 0);
      assert.equal(f.delivery.isHandlerProcessed(f.event.event_id, handlerId), false);
      assert.equal(f.delivery.isProcessed(f.event.event_id), false);
      assert.equal(f.delivery.listOutbox(identity.merchantId).length, 1);
    } finally { release(); }
    await active;
    assert.equal(following, 1);
    assert.equal(f.delivery.isProcessed(f.event.event_id), true);
  });

  it("lost append ACK reuses one deterministic child without falsely completing the parent", async t => {
    const f = await deliveryFixture("always");
    const attempts: DomainEventEnvelope[] = [];
    t.mock.method(f.enqueue, "appendOutbox", async (event: DomainEventEnvelope) => {
      attempts.push(structuredClone(event));
      const result = f.delivery.appendOutbox(event);
      if (attempts.length === 1) throw new Error(sensitiveFailure);
      return result;
    });
    const dispatcher = new OutboxDispatcher(f.delivery, f.bus, { concurrency: 1 });
    t.after(() => dispatcher.onModuleDestroy());
    let following = 0;
    f.bus.subscribe("order.completed", async () => { following++; }, "test.following-handler");
    await dispatcher.dispatch();
    assert.equal(following, 0);
    assert.equal(f.delivery.isProcessed(f.event.event_id), false);
    assert.equal(attempts.length, 1);
    f.delivery.advance(60_000);
    await dispatcher.dispatch();
    assert.equal(following, 1);
    assert.equal(f.delivery.isProcessed(f.event.event_id), true);
    assert.equal(attempts.length, 2);
    assert.equal(attempts[0].event_id, attempts[1].event_id);
    assert.deepEqual(attempts[0].payload, attempts[1].payload);
    const children = f.delivery.listOutbox(identity.merchantId).filter(event => event.event_type === "coupon.redemption.requested");
    assert.equal(children.length, 1);
    assert.deepEqual(children[0], attempts[0], "upsert keeps the first committed child rather than replacing it");
  });

  it("fastpath success does not enqueue any retry job or delay following handlers", async t => {
    const f = await deliveryFixture("before");
    f.calls.push(identity, identity); // fault seam is exhausted before this independent successful delivery
    const dispatcher = new OutboxDispatcher(f.delivery, f.bus, { concurrency: 1 });
    t.after(() => dispatcher.onModuleDestroy());
    let following = 0;
    f.bus.subscribe("order.completed", async () => { following++; }, "test.following-handler");
    await dispatcher.dispatch();
    assert.equal(following, 1);
    assert.equal(f.delivery.isProcessed(f.event.event_id), true);
    assert.equal(f.enqueueCalls.length, 0);
    assert.equal(f.delivery.listOutbox(identity.merchantId).length, 1);
    await assertSingleLocalRedemption(f);
  });

  it("stable retry identity includes the full tenant/session/order JSON tuple, never correlation or payload text", async () => {
    const setup = makeSetup();
    const bus = new FakeEventBus();
    const transactions: CouponTransactionRepository = {
      reserve: input => setup.transactions.reserve(input),
      redeem: async () => { throw new Error(sensitiveFailure); },
    };
    const appended: DomainEventEnvelope[] = [];
    new CouponsOnOrderCompletedHandler(bus, new RedeemCouponUseCase(transactions),
      { appendOutbox: async (event: DomainEventEnvelope) => { appended.push(event); return event; } }).onModuleInit();
    const tuples = [["a", "b:c", "d"], ["a:b", "c", "d"], ["foreign", "b:c", "d"], ["a", "b:c", "other"]];
    for (const [merchantId, sessionId, orderId] of tuples) {
      const event: DomainEvent = { eventType: "order.completed", merchantId,
        payload: { session_id: sessionId, external_order_id: orderId, irrelevant: sensitiveFailure } };
      await bus.publish(event);
      await bus.publish({ ...event, eventId: "another-parent", correlationId: "another-correlation" });
    }
    assert.equal(appended.length, 8);
    const ids = tuples.map((tuple, index) => {
      const expected = "evt_coupon_redemption_retry_" + createHash("sha256").update(JSON.stringify(tuple)).digest("hex");
      assert.equal(appended[index * 2].event_id, expected);
      assert.equal(appended[index * 2 + 1].event_id, expected);
      assert.equal(appended[index * 2].correlation_id, expected);
      assert.equal(appended[index * 2].causation_id, "order.completed");
      assert.equal(appended[index * 2 + 1].causation_id, "another-parent");
      assert.equal(JSON.stringify(appended[index * 2]).includes(sensitiveFailure), false);
      return expected;
    });
    assert.equal(new Set(ids).size, tuples.length);
  });

  const validChild = { session_id: identity.sessionId, external_order_id: identity.orderId };
  const invalidChildren: { name: string; payload: unknown; merchantId?: string }[] = [
    { name: "null", payload: null }, { name: "undefined", payload: undefined }, { name: "array", payload: [] },
    { name: "missing session", payload: { external_order_id: identity.orderId } },
    { name: "missing order", payload: { session_id: identity.sessionId } },
    { name: "number session", payload: { ...validChild, session_id: 42 } },
    { name: "object order", payload: { ...validChild, external_order_id: {} } },
    { name: "empty session", payload: { ...validChild, session_id: "" } },
    { name: "blank order", payload: { ...validChild, external_order_id: " \t" } },
    { name: "oversized session", payload: { ...validChild, session_id: "s".repeat(192) } },
    { name: "oversized order", payload: { ...validChild, external_order_id: "o".repeat(192) } },
    { name: "forged merchant_id", payload: { ...validChild, merchant_id: "foreign" } },
    { name: "forged merchantId", payload: { ...validChild, merchantId: "foreign" } },
    { name: "untrusted financial field", payload: { ...validChild, discount_applied: 999 } },
    { name: "extra cause", payload: { ...validChild, cause: sensitiveFailure } },
    { name: "empty envelope tenant", payload: validChild, merchantId: "" },
    { name: "blank envelope tenant", payload: validChild, merchantId: " \n" },
    { name: "oversized envelope tenant", payload: validChild, merchantId: "m".repeat(192) },
  ];
  for (const input of invalidChildren) it("strict child boundary rejects " + input.name + " before redemption/enqueue", async () => {
    const bus = new FakeEventBus();
    let calls = 0, enqueues = 0;
    const transactions: CouponTransactionRepository = {
      reserve: async () => { throw new Error("reserve_must_not_run"); },
      redeem: async () => { calls++; },
    };
    new CouponsOnOrderCompletedHandler(bus, new RedeemCouponUseCase(transactions),
      { appendOutbox: async (event: DomainEventEnvelope) => { enqueues++; return event; } }).onModuleInit();
    await assert.rejects(bus.publish({ eventType: "coupon.redemption.requested", merchantId: input.merchantId ?? identity.merchantId,
      payload: input.payload }), (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.equal(error.message, "coupon_redemption_failed");
      assert.equal(Object.hasOwn(error, "cause"), false);
      return true;
    });
    assert.equal(calls, 0);
    assert.equal(enqueues, 0);
  });

  it("pending fastpath snapshots tuple and parent metadata before an await", async () => {
    const bus = new FakeEventBus();
    let fail!: () => void;
    const gate = new Promise<void>((_, reject) => { fail = () => reject(new Error(sensitiveFailure)); });
    const transactions: CouponTransactionRepository = {
      reserve: async () => { throw new Error("reserve_must_not_run"); },
      redeem: async () => gate,
    };
    const appended: DomainEventEnvelope[] = [];
    new CouponsOnOrderCompletedHandler(bus, new RedeemCouponUseCase(transactions),
      { appendOutbox: async (event: DomainEventEnvelope) => { appended.push(event); return event; } }).onModuleInit();
    const payload = { ...validChild };
    const event = { eventType: "order.completed", merchantId: identity.merchantId, eventId: "original-parent",
      correlationId: "original-correlation", causationId: "original-causation", payload };
    const work = bus.publish(event);
    event.merchantId = "foreign";
    event.eventId = event.correlationId = event.causationId = "mutated";
    payload.session_id = payload.external_order_id = "mutated";
    fail();
    await work;
    assert.equal(appended.length, 1);
    assert.equal(appended[0].merchant_id, identity.merchantId);
    assert.equal(appended[0].correlation_id, "original-correlation");
    assert.equal(appended[0].causation_id, "original-parent");
    assert.deepEqual(appended[0].payload, validChild);
  });
});
