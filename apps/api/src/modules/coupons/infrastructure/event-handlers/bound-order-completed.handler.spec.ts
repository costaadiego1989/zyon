import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import type { DomainEventEnvelope } from "@zyon/shared-types";
import type { DomainEvent } from "../../../../shared/events/domain-event-bus.port.js";
import { InMemoryDomainEventBus } from "../../../../shared/events/in-memory-domain-event-bus.js";
import { CouponsOnOrderCompletedHandler } from "./on-order-completed.handler.js";
import { RedeemCouponUseCase } from "../../application/use-cases/redeem-coupon.use-case.js";
import type { BoundCouponRedemption } from "../../domain/ports/bound-coupon-redemption.port.js";

const authority = { version: 1, bindingId: "11111111-1111-4111-8111-111111111111", merchantId: "mrc_1",
  cartId: "cart_1", checkoutSessionId: "chk_1", buyerId: "usr_1", reservationBuyerId: null,
  redemptionId: "redemption_1", couponId: "coupon_1", discountCents: 1000, basisHash: "a".repeat(64), orderId: "ord_1" };

function setup(bound?: BoundCouponRedemption) {
  const bus = new InMemoryDomainEventBus();
  let legacyCalls = 0;
  const jobs: DomainEventEnvelope[] = [];
  const references: Array<{ merchantId: string; eventId: string }> = [];
  const redeem = new RedeemCouponUseCase({ reserve: async () => ({ status: "already_applied" }), redeem: async () => { legacyCalls++; } });
  const outbox = { appendOutbox: async (event: DomainEventEnvelope) => { jobs.push(structuredClone(event)); return event; } };
  new CouponsOnOrderCompletedHandler(bus, redeem, outbox, bound ?? { redeem: async input => { references.push(input); } }).onModuleInit();
  const event: DomainEvent = { eventType: "order.completed", merchantId: "mrc_1", eventId: "source_1", correlationId: "corr_1",
    payload: { session_id: "chk_1", external_order_id: "ord_1", payment_intent_id: "intent_1", coupon_authority: structuredClone(authority) } };
  return { bus, event, jobs, references, outbox, legacyCalls: () => legacyCalls };
}

test("bound parent invokes only exact persisted-source command, never cart/session legacy lookup", async () => {
  const f = setup();
  await f.bus.publish(f.event);
  assert.deepEqual(f.references, [{ merchantId: "mrc_1", eventId: "source_1" }]);
  assert.equal(f.legacyCalls(), 0);
  assert.equal(f.jobs.length, 0);
});

test("normal standalone coupon uses the same historical source command and never legacy cart lookup",async()=>{
  const f=setup();Reflect.deleteProperty(f.event.payload as object,"coupon_authority");
  Reflect.set(f.event.payload as object,"normal_coupon_owner",{kind:"checkout_coupon",merchantId:"mrc_1",checkoutSessionId:"chk_1",buyerId:"usr_1",
    reservationBuyerId:"usr_1",couponId:"coupon_1",redemptionId:"redemption_1",code:"SAVE",discountCents:1000,
    applicationEventId:"application_1",reservationUpdatedAt:"2026-10-20T12:00:00.000Z"});
  await f.bus.publish(f.event);assert.deepEqual(f.references,[{merchantId:"mrc_1",eventId:"source_1"}]);assert.equal(f.legacyCalls(),0);
});

test('mixed coupon authorities fail closed before redemption or retry enqueue',async()=>{
  const f=setup();Reflect.set(f.event.payload as object,'normal_coupon_owner',{});
  await assert.rejects(f.bus.publish(f.event),/^Error: coupon_redemption_failed$/);
  assert.equal(f.references.length+f.jobs.length+f.legacyCalls(),0);
});

test("bound retry carries only the immutable source event reference and permits subsequent consumers", async () => {
  const attempts: Array<{ merchantId: string; eventId: string }> = [];
  const f = setup({ redeem: async input => { attempts.push(input); if (attempts.length === 1) throw new Error("secret provider cause"); } });
  let following = 0;
  f.bus.subscribe("order.completed", async () => { following++; }, "test.following");
  await f.bus.publish(f.event);
  assert.equal(following, 1);
  assert.equal(f.jobs.length, 1);
  assert.deepEqual(f.jobs[0].payload, { source_event_id: "source_1" });
  assert.equal(f.jobs[0].event_id, "evt_coupon_redemption_retry_" + createHash("sha256").update(JSON.stringify(["mrc_1", "bound", "source_1"])).digest("hex"));
  assert.equal(f.jobs[0].correlation_id, "corr_1");
  await f.bus.publish({ eventType: "coupon.redemption.requested", merchantId: "mrc_1", payload: f.jobs[0].payload });
  assert.deepEqual(attempts, [{ merchantId: "mrc_1", eventId: "source_1" }, { merchantId: "mrc_1", eventId: "source_1" }]);
  assert.equal(f.legacyCalls(), 0);
  assert.equal(f.jobs.length, 1);
  assert.equal(JSON.stringify(f.jobs).includes("secret provider cause"), false);
});

test("bound enqueue failure or missing command is fixed failure with no legacy fallback", async t => {
  const f = setup({ redeem: async () => { throw new Error("sensitive"); } });
  t.mock.method(f.outbox, "appendOutbox", async () => { throw new Error("sensitive append"); });
  await assert.rejects(f.bus.publish(f.event), /^Error: coupon_redemption_failed$/);
  assert.equal(f.legacyCalls(), 0);
  const bus = new InMemoryDomainEventBus();
  let legacy = 0;
  new CouponsOnOrderCompletedHandler(bus, new RedeemCouponUseCase({ reserve: async () => ({ status: "already_applied" }), redeem: async () => { legacy++; } }), f.outbox).onModuleInit();
  await assert.rejects(bus.publish(f.event), /^Error: coupon_redemption_failed$/);
  assert.equal(legacy, 0);
});

for (const [name, patch] of Object.entries({ null: { coupon_authority: null }, undefined: { coupon_authority: undefined },
  tenant: { coupon_authority: { ...authority, merchantId: "other" } }, checkout: { session_id: "other" },
  order: { external_order_id: "other" }, extra: { coupon_authority: { ...authority, injected: true } } })) {
  test("present invalid bound parent never falls back or enqueues: " + name, async () => {
    const f = setup();
    const event = { ...f.event, payload: { ...(f.event.payload as Record<string, unknown>), ...patch } };
    await assert.rejects(f.bus.publish(event), /^Error: coupon_redemption_failed$/);
    assert.equal(f.legacyCalls(), 0);
    assert.equal(f.references.length, 0);
    assert.equal(f.jobs.length, 0);
  });
}

test("bound parent without durable event identity cannot authorize a lookup or enqueue", async () => {
  const f = setup();
  await assert.rejects(f.bus.publish({ ...f.event, eventId: undefined }), /^Error: coupon_redemption_failed$/);
  assert.equal(f.references.length + f.jobs.length + f.legacyCalls(), 0);
});

for (const payload of [{ source_event_id: null }, { source_event_id: undefined }, { source_event_id: " " },
  { source_event_id: "source_1", session_id: "chk_1", external_order_id: "ord_1" }]) {
  test("invalid bound retry is not treated as legacy and never recursively enqueues: " + JSON.stringify(payload), async () => {
    const f = setup();
    await assert.rejects(f.bus.publish({ eventType: "coupon.redemption.requested", merchantId: "mrc_1", payload }), /^Error: coupon_redemption_failed$/);
    assert.equal(f.references.length + f.jobs.length + f.legacyCalls(), 0);
  });
}

test("bound child failure obeys dispatcher retries without creating another job", async () => {
  const f = setup({ redeem: async () => { throw new Error("sensitive"); } });
  await assert.rejects(f.bus.publish({ eventType: "coupon.redemption.requested", merchantId: "mrc_1", payload: { source_event_id: "source_1" } }), /^Error: coupon_redemption_failed$/);
  assert.equal(f.jobs.length + f.legacyCalls(), 0);
});
