import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { Redis } from "ioredis";
import { createServiceOperationsHttpFixture } from "./service-operations-http.fixture.js";
import { seedApprovedProfessionalCase } from "./service-approved-order.fixture.js";
import { SERVICE_LOCAL_TEST_MS } from "./service-test-startup.mjs";
import { ReconcileServicePaymentUseCase, regularizationIdentity } from "../src/modules/payment/application/reconcile-service-payment.use-case.js";
import { InMemoryDomainEventBus } from "../src/shared/events/in-memory-domain-event-bus.js";
import { TenantContextService } from "../src/shared/tenant/tenant-context.service.js";
import { RedisServiceSlots, closeServiceSlotStore } from "../src/shared/bookings/redis-service-slots.js";
import { professionalHoldRequests, professionalSlotId } from "../src/shared/bookings/service-checkout-selection.js";
import { serviceCheckoutProvenance } from "../src/shared/bookings/service-checkout-provenance.js";
import { prepareManualServicePaymentWithin } from "../src/shared/bookings/manual-service-payment-continuation.js";
import { reserveProfessionalOrderUnit } from "../src/shared/bookings/service-order-appointment.js";
import { lockCatalogMerchant } from "../src/shared/persistence/catalog-stock-ledger.js";

// Approval rows are synthetic local PSP evidence. Canonical SQL/Redis, HTTP
// identity, inbox and transaction rollback are real; no payment dispatch occurs.
test("T36 approved late payment keeps real money and truthful regularization", { timeout: SERVICE_LOCAL_TEST_MS }, async t => {
  const f = await createServiceOperationsHttpFixture({ serviceReleaseFixture: "matching" }), previousRedis = process.env.REDIS_URL;
  let redis: Redis | undefined;
  try {
    process.env.REDIS_URL = f.runtime.redis.url;
    redis = new Redis(f.runtime.redis.url, { lazyConnect: true, maxRetriesPerRequest: 1, commandTimeout: 3000, connectTimeout: 3000, enableOfflineQueue: false });
    await redis.connect(); assert.equal(await redis.get("aacp:synthetic:run"), f.runtime.redis.runId);
    const store = new RedisServiceSlots(redis), command = new ReconcileServicePaymentUseCase(f.prisma, new InMemoryDomainEventBus(), new TenantContextService());
    let accepted: Awaited<ReturnType<typeof seedApprovedProfessionalCase>>;
    const run = (c: any) => command.execute(c.merchantId, c.payment.id);
    const noticeFor = (c: any) => f.prisma.merchantNotification.findUnique({ where: {
      id: "service-payment-regularization:" + regularizationIdentity(c.merchantId, c.payment.id, c.order.id, c.unitId) } });
    const paid = (c: any) => f.prisma.paymentIntent.findUniqueOrThrow({ where: { id: c.payment.id } });
    const ordered = (c: any) => f.prisma.serviceAppointment.findMany({ where: { merchantId: c.merchantId, orderId: c.order.id } });
    const duplicate = async (c: any, suffix: string) => {
      const sessionId = "late-competitor-" + suffix, buyerId = "late-competitor-buyer-" + suffix, intentId = "late-competitor-intent-" + suffix;
      const providerId = "late-competitor-provider-" + suffix, scope = { merchantId: c.merchantId, sessionId, globalUserId: buyerId };
      await f.prisma.checkoutSession.create({ data: { ...scope, ...serviceCheckoutProvenance(scope, { serverChannel: "storefront" }),
        conversationId: sessionId, cart: { items: [], total: 50, currency: "BRL" }, customer: { fullName: "Synthetic competitor", email: "competitor@example.test" }, createdAt: new Date(), updatedAt: new Date() } });
      const payment = await f.prisma.paymentIntent.create({ data: { id: intentId, merchantId: c.merchantId, sessionId, idempotencyKey: intentId,
        amountCents: 5000, approvedAmountCents: 5000, currency: "BRL", status: "approved", method: "pix", providerPaymentId: providerId } });
      const order = await f.prisma.completedOrder.create({ data: { id: randomUUID(), merchantId: c.merchantId, sessionId,
        externalOrderId: providerId, orderTotal: 50, currency: "BRL", completedAt: new Date(), lineItemsJson: c.order.lineItemsJson } });
      return { ...c, payment, order, sessionId };
    };
    const assertReview = async (c: any) => {
      const notice = await noticeFor(c); assert.ok(notice); const metadata = notice.metadata as any;
      assert.equal(notice.merchantId, c.merchantId); assert.equal(notice.type, "service_payment_regularization");
      assert.equal(metadata.paymentIntentId, c.payment.id); assert.equal(metadata.orderId, c.order.id); assert.equal(metadata.unitId, c.unitId);
      assert.equal(metadata.paymentStatus, "approved"); assert.equal(metadata.approvedAmountCents, 5000); assert.equal(metadata.currency, "BRL");
      assert.equal(metadata.providerPaymentId, c.payment.providerPaymentId); assert.equal(metadata.bookingConfirmed, false);
      assert.equal((await ordered(c)).length, 0); assert.equal((await paid(c)).status, "approved");
      return notice;
    };
    await t.test("valid approved replay preserves T35 appointment balance audits and event receipts exactly", async () => {
      const c = accepted = await seedApprovedProfessionalCase(f, "late-valid"), money = await paid(c);
      const first = await run(c); assert.equal(first.status, "processed"); assert.equal(first.units[0].status, "reconciled");
      assert.equal(first.units[0].bookingConfirmed, true);
      const [a] = await ordered(c); assert.ok(a); assert.equal(a.operationalStatus, "scheduled");
      const snapshot = await f.snapshot(a.id); await Promise.all([run(c), run(c)]);
      assert.deepEqual(await f.snapshot(a.id), snapshot); assert.deepEqual(await paid(c), money); assert.equal(await noticeFor(c), null);
      assert.equal(snapshot.balances.length, 1); assert.equal(snapshot.balances[0].status, "approved");
      assert.equal(await f.prisma.attendanceReceipt.count(), 0); assert.equal(await f.prisma.inventoryMovement.count(), 0);
    });
    await t.test("two immutable service units remain confirmed with their existing per-unit payments and no false warning", async () => {
      const c = await seedApprovedProfessionalCase(f, "late-two"), line = (c.order.lineItemsJson as any[])[0];
      const second = { ...line, lineId: c.unitId + "-second", schedule: { ...line.schedule,
        startsAt: c.date + "T10:20:00.000Z", endsAt: c.date + "T10:40:00.000Z" } };
      const selected = { ...c.selected, ...second.schedule }; second.schedule.slotId = professionalSlotId(c.merchantId, selected);
      await f.prisma.completedOrder.update({ where: { id: c.order.id }, data: { orderTotal: 100, lineItemsJson: [line, second] } });
      await f.prisma.paymentIntent.update({ where: { id: c.payment.id }, data: { amountCents: 10100, approvedAmountCents: 10100,
        amountBreakdown: { version: 1, currency: "BRL", itemsSubtotalCents: 10000, discountCents: 0, shippingCents: 0, platformFeeCents: 100, totalCents: 10100 } } });
      const result = await run(c); assert.equal(result.units.length, 2); assert.ok(result.units.every(unit => unit.bookingConfirmed && unit.status === "reconciled"));
      const appointments = await ordered(c); assert.equal(appointments.length, 2);
      const balances = await f.prisma.appointmentPayment.findMany({ where: { paymentIntentId: c.payment.id } });
      assert.equal(balances.length, 2); assert.deepEqual(balances.map(p => p.amountCents), [5000, 5000]);
      assert.ok(balances.every(p => p.status === "approved")); assert.equal(await noticeFor(c), null);
      const before = await Promise.all(appointments.map(a => f.snapshot(a.id))); await run(c);
      assert.deepEqual(await Promise.all(appointments.map(a => f.snapshot(a.id))), before);
    });
    await t.test("occupied capacity creates one owner-visible receipt without changing a foreign tenant or charging again", async () => {
      const c = await seedApprovedProfessionalCase(f, "late-occupied"), competitor = await duplicate(c, "occupied");
      const admitted = await run(competitor); assert.equal(admitted.units[0].bookingConfirmed, true);
      const [winner] = await ordered(competitor); assert.ok(winner);
      const before = await f.snapshot(winner.id), money = await paid(c);
      assert.equal((await run(c)).units[0].status, "regularization"); const notice = await assertReview(c);
      const inbox = await f.request("/merchants/" + c.merchantId + "/notifications", undefined, f.owner, "GET");
      assert.equal(inbox.status, 200); assert.ok(inbox.body.items.some((row: any) => row.id === notice.id));
      const foreign = await f.request("/merchants/" + c.merchantId + "/notifications", undefined, f.foreign, "GET");
      assert.equal(foreign.status, 403);
      await Promise.all([run(c), run(c)]); assert.deepEqual(await noticeFor(c), notice); assert.deepEqual(await paid(c), money);
      assert.deepEqual(await f.snapshot(winner.id), before); assert.equal(await f.prisma.appointmentPayment.count({ where: { paymentIntentId: c.payment.id } }), 0);
      assert.equal(await f.prisma.merchantNotification.count({ where: { merchantId: f.foreign.merchant_id, type: "service_payment_regularization" } }), 0);
    });
    await t.test("the real original Redis lease expires before late approval is reconciled", async () => {
      const c = await seedApprovedProfessionalCase(f, "late-expired"), policy = await f.prisma.serviceBusinessPolicy.findUniqueOrThrow({ where: { merchantId: c.merchantId } });
      const changed = await f.request("/merchants/me/service-business-policy", { expectedVersion: policy.version, paymentMode: "online",
        admissionsEnabled: true, holdEnabled: true, holdMinutes: 7 }, f.owner, "PUT"); assert.equal(changed.status, 200);
      const selected = { ...c.selected, policyVersion: changed.body.version }, line = (c.order.lineItemsJson as any[])[0];
      const schedule = { ...c.schedule, policyVersion: selected.policyVersion, slotId: professionalSlotId(c.merchantId, selected) };
      await f.prisma.completedOrder.update({ where: { id: c.order.id }, data: { lineItemsJson: [{ ...line, schedule }] } });
      const held = await store.acquire(c.merchantId, c.sessionId, professionalHoldRequests([{ ...selected, slotId: schedule.slotId }]), 1);
      assert.equal(held.slots.length, 1); await new Promise(resolve => setTimeout(resolve, 15));
      assert.equal(await store.get(c.merchantId, c.sessionId), undefined);
      const retainedExpired = await redis!.get(store.checkoutKey(c.merchantId, c.sessionId)); assert.ok(retainedExpired);
      const [seconds, microseconds] = await redis!.time();
      assert.ok(JSON.parse(retainedExpired).expiresAt <= Number(seconds) * 1000 + Math.floor(Number(microseconds) / 1000));
      const money = await paid(c); assert.equal((await run(c)).units[0].status, "regularization"); await assertReview(c);
      assert.deepEqual(await paid(c), money); assert.equal(await redis!.get(store.checkoutKey(c.merchantId, c.sessionId)), retainedExpired);
      await store.acquire(c.merchantId, c.sessionId, professionalHoldRequests([{ ...selected, slotId: schedule.slotId }]), 420_000);
      const newer = await redis!.get(store.checkoutKey(c.merchantId, c.sessionId)); assert.ok(newer);
      await run(c); assert.equal((await ordered(c)).length, 0);
      assert.equal(await redis!.get(store.checkoutKey(c.merchantId, c.sessionId)), newer);
    });
    await t.test("disabled admissions preserve started approval and replay never retries against a newly enabled slot", async () => {
      const c = await seedApprovedProfessionalCase(f, "late-disabled"), policy = await f.prisma.serviceBusinessPolicy.findUniqueOrThrow({ where: { merchantId: c.merchantId } });
      const changed = await f.request("/merchants/me/service-business-policy", { expectedVersion: policy.version, paymentMode: "online", admissionsEnabled: false, holdEnabled: false }, f.owner, "PUT");
      assert.equal(changed.status, 200); assert.equal((await run(c)).units[0].status, "regularization"); const notice = await assertReview(c);
      const [confirmed] = await ordered(accepted!), before = await f.snapshot(confirmed.id);
      assert.equal((await run(accepted!)).units[0].bookingConfirmed, true);
      assert.deepEqual(await f.snapshot(confirmed.id), before); assert.equal(await noticeFor(accepted!), null);
      const enabled = await f.request("/merchants/me/service-business-policy", { expectedVersion: changed.body.version, paymentMode: "online", admissionsEnabled: true, holdEnabled: false }, f.owner, "PUT");
      assert.equal(enabled.status, 200); await run(c); assert.deepEqual(await noticeFor(c), notice); assert.equal((await ordered(c)).length, 0);
    });
    await t.test("unknown pending failed and mismatched approval cannot create booking balances or a second payment attempt", async () => {
      const c = await seedApprovedProfessionalCase(f, "late-status");
      for (const status of ["unknown", "pending", "failed"]) {
        await f.prisma.paymentIntent.update({ where: { id: c.payment.id }, data: { status } }); assert.equal((await run(c)).status, "not_approved");
      }
      for (const data of [{ status: "approved", approvedAmountCents: 4999 }, { status: "approved", approvedAmountCents: 5000, currency: "USD" }]) {
        await f.prisma.paymentIntent.update({ where: { id: c.payment.id }, data }); await assert.rejects(run(c), /fulfillment_payment_required/);
      }
      assert.equal((await ordered(c)).length, 0); assert.equal(await noticeFor(c), null);
      assert.equal(await f.prisma.paymentIntent.count({ where: { sessionId: c.sessionId } }), 1);
      assert.equal(await f.prisma.appointmentPayment.count({ where: { paymentIntentId: c.payment.id } }), 0);
    });
    await t.test("a later cancellation remains cancelled and retains its existing approved financial receipt", async () => {
      const c = await seedApprovedProfessionalCase(f, "late-cancelled"); await run(c); const [a] = await ordered(c);
      const policy = await f.request(f.prefix() + "/" + a.id + "/operation-policy", undefined, f.owner, "GET"); assert.equal(policy.status, 200);
      const cancelled = await f.request(f.prefix() + "/" + a.id + "/cancel", { expectedVersion: a.version, commandId: "late-cancel",
        operatorRequestId: "late-cancel-request", policyHash: policy.body.hash }); assert.equal(cancelled.status, 201);
      const before = await f.snapshot(a.id), result = await run(c); assert.equal(result.units[0].bookingConfirmed, false);
      assert.equal(result.units[0].status, "regularization"); const notice = await noticeFor(c); assert.ok(notice);
      assert.equal((notice.metadata as any).appointmentId, a.id); assert.equal((notice.metadata as any).bookingConfirmed, false);
      const after = await f.snapshot(a.id); assert.deepEqual(after.appointment, before.appointment);
      assert.equal(after.balances[0].id, before.balances[0].id); assert.equal(after.balances[0].status, "approved");
      assert.equal(after.balances[0].amountCents, before.balances[0].amountCents); assert.equal(after.balances[0].requiresRegularization, true);
      assert.deepEqual(after.audits, before.audits); assert.deepEqual(after.events, before.events);
    });
    await t.test("the merchant and professional lock race admits one actual winner and routes the late loser to regularization", async () => {
      const c = await seedApprovedProfessionalCase(f, "late-race"), competitor = await duplicate(c, "race");
      let release!: () => void, locked!: () => void;
      const acquired = new Promise<void>(resolve => { locked = resolve; }), gate = new Promise<void>(resolve => { release = resolve; });
      const winner = f.prisma.$transaction(async tx => { await lockCatalogMerchant(tx, c.merchantId); locked(); await gate;
        return reserveProfessionalOrderUnit(tx, c.merchantId, competitor.order.id, competitor.unitId); });
      await acquired; const loser = run(c); release(); await winner; const result = await loser;
      assert.equal(result.units[0].status, "regularization"); await assertReview(c);
      assert.equal((await ordered(competitor)).length, 1); assert.equal(await f.prisma.serviceAppointment.count({ where: {
        merchantId: c.merchantId, professionalId: c.professional.id, startsAt: c.selected.startsAt, operationalStatus: "scheduled" } }), 1);
    });
    await t.test("notification SQL failure rolls back visibility and a clean retry preserves the exact approval", async () => {
      const c = await seedApprovedProfessionalCase(f, "late-notice-rollback", { proven: false }), money = await paid(c);
      await f.runtime.db.sql("CREATE FUNCTION t36_fail_notice() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic_t36_notice_failure'; END $$; CREATE TRIGGER t36_fail_notice BEFORE INSERT ON merchant_notifications FOR EACH ROW EXECUTE FUNCTION t36_fail_notice();");
      try { await assert.rejects(run(c), /synthetic_t36_notice_failure/); assert.equal(await noticeFor(c), null);
        assert.equal((await ordered(c)).length, 0); assert.deepEqual(await paid(c), money);
      } finally { await f.runtime.db.sql("DROP TRIGGER t36_fail_notice ON merchant_notifications; DROP FUNCTION t36_fail_notice();"); }
      await run(c); await assertReview(c); assert.deepEqual(await paid(c), money);
    });
    await t.test("outbox failure cannot leave a visible uncommitted regularization receipt", async () => {
      const c = await seedApprovedProfessionalCase(f, "late-outbox-rollback", { proven: false }), money = await paid(c);
      await f.runtime.db.sql("CREATE FUNCTION t36_fail_event() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.event_type='service.payment.regularization_required' THEN RAISE EXCEPTION 'synthetic_t36_outbox_failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER t36_fail_event BEFORE INSERT ON outbox_messages FOR EACH ROW EXECUTE FUNCTION t36_fail_event();");
      try { await assert.rejects(run(c), /synthetic_t36_outbox_failure/); assert.equal(await noticeFor(c), null);
        assert.equal((await ordered(c)).length, 0); assert.deepEqual(await paid(c), money);
      } finally { await f.runtime.db.sql("DROP TRIGGER t36_fail_event ON outbox_messages; DROP FUNCTION t36_fail_event();"); }
      await run(c); await assertReview(c); assert.deepEqual(await paid(c), money);
    });
    await t.test("a trusted manual pending correlation retains the SAME original identity when late approval cannot promote it", async () => {
      const c = await seedApprovedProfessionalCase(f, "late-manual"), a = await f.prisma.serviceAppointment.findUniqueOrThrow({ where: { id: c.appointment.id } });
      await f.prisma.completedOrder.delete({ where: { id: c.order.id } });
      const selected = { ...c.selected, slotId: c.schedule.slotId };
      await f.prisma.checkoutSession.update({ where: { merchantId_sessionId: { merchantId: c.merchantId, sessionId: c.sessionId } }, data: {
        cart: { currency: "BRL", total: 50, items: [{ sku: c.product.variants[0].sku, product_id: a.productId, variantId: a.variantId,
          name: "Synthetic manual payment", quantity: 1, price: 50, productType: "service", fulfillmentStrategy: "scheduled_service", fulfillmentSchedule: selected }] } } });
      await f.prisma.paymentIntent.update({ where: { id: c.payment.id }, data: { status: "pending", approvedAmountCents: null, providerPaymentId: null,
        creation: { state: "ready", input: { merchantId: c.merchantId, sessionId: c.sessionId, amountCents: 5000, currency: "BRL", method: "pix", providerIdempotencyKey: c.payment.id } } } });
      const linked = await f.prisma.$transaction(tx => prepareManualServicePaymentWithin(tx, { merchantId: c.merchantId, userId: f.owner.user_id, role: "owner" }, {
        appointmentId: a.id, expectedVersion: a.version, paymentIntentId: c.payment.id, unitId: c.unitId, commandId: "late-manual-prepare" }));
      await f.prisma.paymentIntent.update({ where: { id: c.payment.id }, data: { status: "approved", approvedAmountCents: 5000, providerPaymentId: c.payment.providerPaymentId } });
      await f.prisma.completedOrder.create({ data: { id: c.order.id, merchantId: c.merchantId, sessionId: c.sessionId,
        externalOrderId: c.order.externalOrderId, orderTotal: 50, currency: "BRL", completedAt: new Date(), lineItemsJson: c.order.lineItemsJson as any } });
      const policy = await f.prisma.serviceBusinessPolicy.findUniqueOrThrow({ where: { merchantId: c.merchantId } });
      const disabled = await f.request("/merchants/me/service-business-policy", { expectedVersion: policy.version, paymentMode: "online", holdEnabled: false, admissionsEnabled: false }, f.owner, "PUT");
      assert.equal(disabled.status, 200); const before = await f.snapshot(a.id); await run(c); const after = await f.snapshot(a.id);
      assert.deepEqual(after.appointment, before.appointment); assert.equal(after.appointment.operationalStatus, "pending");
      assert.equal(after.balances.length, 1); assert.equal(after.balances[0].id, linked.payment.id); assert.equal(after.balances[0].status, "pending");
      assert.equal(after.balances[0].requiresRegularization, true); assert.equal(after.balances[0].amountCents, 5000);
      assert.deepEqual(after.audits, before.audits); assert.deepEqual(after.events, before.events);
      const notice = await assertReview(c); assert.equal((notice.metadata as any).appointmentId, a.id);
      assert.equal((await paid(c)).status, "approved");
    });
    assert.equal(await f.prisma.inventoryMovement.count(), 0); assert.equal(await f.prisma.attendanceReceipt.count(), 0);
  } finally {
    try { await closeServiceSlotStore(); } finally {
      try { if (redis) await redis.quit(); } finally {
        if (previousRedis === undefined) delete process.env.REDIS_URL; else process.env.REDIS_URL = previousRedis;
        await f.close();
      }
    }
  }
});
