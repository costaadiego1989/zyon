import assert from "node:assert/strict";
import { test } from "node:test";
import { createHash } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { Redis } from "ioredis";
import { createDisposablePostgres } from "./local-disposable-postgres.mjs";
import { bootstrapServiceSchema } from "./service-migration-bootstrap.mjs";
import { createServiceTestRedis } from "./service-test-redis.mjs";
import { assertServiceArtifacts } from "./service-test-artifacts.mjs";
import { SERVICE_LOCAL_TEST_MS } from "./service-test-startup.mjs";
import { seedServiceBookingFixture, serviceBookingRequest } from "./service-booking-fixtures.js";
import { RedisServiceSlots } from "../src/shared/bookings/redis-service-slots.js";
import { professionalSlotId, type ProfessionalCheckoutSelection } from "../src/shared/bookings/service-checkout-selection.js";
import { acquireProfessionalLease, assertProfessionalLease } from "../src/shared/bookings/professional-service-lease.js";
import { admitServiceAppointment } from "../src/shared/bookings/service-appointment-admission.service.js";
import { getProfessionalAvailability } from "../src/modules/catalog/application/get-professional-availability.js";
import { ServiceSlotHoldsService } from "../src/shared/bookings/service-slot-holds.service.js";
import { toCheckoutSession } from "../src/modules/checkout/domain/services/checkout-session-projection.js";
import { snapshotOrderLines } from "../src/modules/operations/domain/order-fulfillment.js";
import { readProfessionalCheckout } from "../src/shared/bookings/read-professional-checkout.js";
import { lockServiceProfessional } from "../src/shared/bookings/service-professional-lock.js";

test("T27", { timeout: SERVICE_LOCAL_TEST_MS }, async t => {
  assertServiceArtifacts();
  const db = await createDisposablePostgres({ transport: "loopback-exec" });
  let redisOwner: Awaited<ReturnType<typeof createServiceTestRedis>> | undefined;
  let redis: Redis | undefined, prisma: PrismaClient | undefined;
  const unusedClients: Redis[] = [];
  try {
    await db.sql(`CREATE TABLE synthetic_native_marker(run_id TEXT PRIMARY KEY); INSERT INTO synthetic_native_marker VALUES ('${db.runId}');`);
    await bootstrapServiceSchema(db);
    redisOwner = await createServiceTestRedis();
    redis = new Redis(redisOwner.url, { lazyConnect: true, maxRetriesPerRequest: 1, commandTimeout: 3000,
      connectTimeout: 3000, enableOfflineQueue: false });
    await redis.connect(); assert.equal(await redis.get("aacp:synthetic:run"), redisOwner.runId);
    const ownedRedis = redis, store = new RedisServiceSlots(redis);
    prisma = new PrismaClient({ datasources: { db: { url: db.prismaUrl } } });
    const raw = prisma, now = new Date();
    await seedServiceBookingFixture(raw, now);
    const date = new Date(now.getTime() + 2 * 86_400_000).toISOString().slice(0, 10);
    const input = serviceBookingRequest(date, "confirmed-after-expiry");
    const base = { productId: input.productId, variantId: input.variantId, professionalId: input.professionalId,
      professionalVersion: 1, policyVersion: 1, date, startsAt: input.startsAt, endsAt: input.endsAt,
      timeZone: "UTC", durationMinutes: 20, priceInCents: 5000, currency: "BRL" };
    const selected: ProfessionalCheckoutSelection = { ...base, slotId: professionalSlotId(input.merchantId, base) };
    const owner = { ownerId: "owned-checkout", store: () => store };
    const policy = { holdEnabled: true, holdMinutes: 13, paymentMode: "at_attendance" as const };
    const dateAt = (offset: number) => new Date(now.getTime() + offset * 86_400_000).toISOString().slice(0, 10);
    const seedCheckout = async (suffix: string, selectedDate: string, policyVersion: number) => {
      const request = serviceBookingRequest(selectedDate, suffix, { policyVersion });
      const tuple = { ...base, date: selectedDate, startsAt: request.startsAt, endsAt: request.endsAt, policyVersion };
      const choice = { ...tuple, slotId: professionalSlotId(request.merchantId, tuple) };
      const schedule = { slotId: choice.slotId, date: choice.date, startsAt: choice.startsAt, endsAt: choice.endsAt,
        timeZone: choice.timeZone, durationMinutes: choice.durationMinutes, professionalId: choice.professionalId,
        professionalVersion: choice.professionalVersion, policyVersion: choice.policyVersion };
      const row = await raw.checkoutSession.create({ data: { merchantId: request.merchantId, sessionId: suffix, globalUserId: request.buyerGlobalUserId!,
        conversationId: "synthetic-" + suffix, createdAt: now, updatedAt: now,
        cart: { currency: "BRL", total: 50, items: [{ sku: request.productId,
          product_id: request.productId, variantId: request.variantId, name: "Synthetic cached service", quantity: 1, price: 50,
          productType: "service", fulfillmentStrategy: "scheduled_service", fulfillmentSchedule: schedule }] } } });
      return { request, choice, session: toCheckoutSession(row) };
    };
    await t.test("server Redis time controls configured TTL and retry never renews it", async () => {
      const [seconds, micros] = await ownedRedis.time();
      const before = Number(seconds) * 1000 + Math.floor(Number(micros) / 1000);
      const first = await acquireProfessionalLease(input.merchantId, [selected], policy, owner);
      assert.ok(first); const expires = Date.parse(first.expiresAt);
      assert.ok(expires >= before + 13 * 60_000 && expires <= before + 13 * 60_000 + 3000);
      const retry = await acquireProfessionalLease(input.merchantId, [selected], policy, owner);
      assert.deepEqual(retry, first);
      await assertProfessionalLease(input.merchantId, [selected], policy, owner);
    });
    await t.test("foreign owner and changed policy/calendar identity cannot borrow a lease", async () => {
      await assert.rejects(assertProfessionalLease(input.merchantId, [selected], policy, { ownerId: "foreign-checkout", store: () => store }), /hold_expired/);
      await assert.rejects(acquireProfessionalLease(input.merchantId, [selected], policy, { ownerId: "foreign-checkout", store: () => store }), /slot_unavailable/);
      const changed = { ...selected, policyVersion: 2 };
      changed.slotId = professionalSlotId(input.merchantId, changed);
      await assert.rejects(assertProfessionalLease(input.merchantId, [changed], policy, owner), /hold_expired/);
    });
    await t.test("expiry releases only provisional capacity; an old lease cannot confirm", async () => {
      // Deterministic test clock boundary in the owned Redis record. The actual
      // production Lua script still compares it against Redis TIME.
      const key = store.checkoutKey(input.merchantId, owner.ownerId);
      const previous = await ownedRedis.get(key); assert.ok(previous);
      const held = JSON.parse(previous); held.expiresAt = 1;
      await ownedRedis.set(key, JSON.stringify(held));
      await ownedRedis.hset(store.resourceKey(input.merchantId, "professional:" + selected.professionalId), held.owner, JSON.stringify(held));
      await assert.rejects(assertProfessionalLease(input.merchantId, [selected], policy, owner), /hold_expired/);
      await raw.serviceBusinessPolicy.update({ where: { merchantId: input.merchantId }, data: { holdEnabled: true, holdMinutes: 13 } });
      await assert.rejects(raw.$transaction(tx => admitServiceAppointment(tx, input, { clock: () => now, leaseOwner: owner })), /hold_expired/);
      assert.equal(await raw.serviceAppointment.count(), 0); assert.equal(await raw.appointmentAudit.count(), 0); assert.equal(await raw.outboxMessage.count(), 0);
      const fresh = await acquireProfessionalLease(input.merchantId, [selected], policy, owner); assert.ok(fresh);
      const result = await raw.$transaction(tx => admitServiceAppointment(tx, input, { clock: () => now, leaseOwner: owner }));
      assert.equal(result.appointment.operationalStatus, "scheduled");
      const fingerprint = createHash("sha256").update("wrong").digest("hex");
      await store.release(input.merchantId, owner.ownerId, fingerprint);
      assert.ok(await store.get(input.merchantId, owner.ownerId), "wrong release cannot delete the owner's lease");
      await store.release(input.merchantId, owner.ownerId);
      assert.equal(await store.get(input.merchantId, owner.ownerId), undefined);
      const availability = await raw.$transaction(tx => getProfessionalAvailability(tx, { merchantId: input.merchantId,
        professionalId: input.professionalId, productId: input.productId, variantId: input.variantId, fromDate: date, toDate: date, now }));
      assert.equal(availability.slots.some(slot => slot.startsAt === input.startsAt), false);
      assert.equal(await raw.serviceAppointment.count({ where: { operationalStatus: "scheduled" } }), 1);
      assert.equal(await raw.paymentIntent.count(), 0); assert.equal(await raw.inventoryMovement.count(), 0);
    });
    let matrixDay = 3;
    for (const paymentMode of ["online", "at_attendance"] as const) for (const holdEnabled of [false, true]) {
      await t.test("the actual holds service and final admission honor " + paymentMode + " with hold " + (holdEnabled ? "on" : "off"), async () => {
        const row = await raw.serviceBusinessPolicy.update({ where: { merchantId: input.merchantId }, data: { paymentMode, holdEnabled, holdMinutes: holdEnabled ? 7 : null, version: { increment: 1 } } });
        const fixture = await seedCheckout("matrix-" + paymentMode + "-" + holdEnabled, dateAt(matrixDay++), row.version);
        let selectedStore = store;
        if (!holdEnabled) {
          const client = new Redis(redisOwner!.url, { lazyConnect: true, maxRetriesPerRequest: 1, enableOfflineQueue: false });
          unusedClients.push(client); selectedStore = new RedisServiceSlots(client); assert.equal(client.status, "wait");
        }
        const service = new ServiceSlotHoldsService(raw, selectedStore), leaseOwner = { ownerId: fixture.session.sessionId, store: () => selectedStore };
        const time = async () => { const [seconds, micros] = await ownedRedis.time(); return Number(seconds) * 1000 + Math.floor(Number(micros) / 1000); };
        const beforeAcquire = holdEnabled ? await time() : 0;
        const held = await service.acquire(fixture.session);
        if (holdEnabled) {
          const afterAcquire = await time(); assert.ok(held);
          assert.ok(Date.parse(held.expiresAt) >= beforeAcquire + 7 * 60_000 && Date.parse(held.expiresAt) <= afterAcquire + 7 * 60_000);
        }
        assert.deepEqual(await service.acquire(fixture.session), held);
        assert.deepEqual(await service.get(fixture.session), held);
        assert.deepEqual(await service.state(fixture.session), { requires_hold: holdEnabled, service_slot_hold: held ?? null });
        await service.assertBeforePayment(fixture.session);
        if (holdEnabled) { assert.ok(held); assert.equal(held.slots[0].resourceId, "professional:" + fixture.choice.professionalId); }
        else { assert.equal(held, undefined); assert.equal(unusedClients.at(-1)!.status, "wait"); }
        let confirmation: typeof fixture.request.confirmation = { kind: "at_attendance" };
        if (paymentMode === "online") {
          const providerId = "synthetic-paid-" + fixture.session.sessionId, orderId = "order-" + fixture.session.sessionId;
          await raw.paymentIntent.create({ data: { id: providerId, merchantId: input.merchantId, sessionId: fixture.session.sessionId, idempotencyKey: providerId,
            amountCents: 5000, approvedAmountCents: 5000, currency: "BRL", method: "pix", status: "approved", providerPaymentId: providerId } });
          await raw.completedOrder.create({ data: { id: orderId, merchantId: input.merchantId, sessionId: fixture.session.sessionId,
            externalOrderId: providerId, orderTotal: 50, currency: "BRL", completedAt: now,
            lineItemsJson: JSON.parse(JSON.stringify(snapshotOrderLines(fixture.session.cart.items))) } });
          confirmation = { kind: "approved_order_unit", orderId, unitId: "line_1" };
        }
        const command = { ...fixture.request, confirmation };
        if (holdEnabled) {
          await assert.rejects(raw.$transaction(tx => admitServiceAppointment(tx, command)), /service_hold_required/);
          await assert.rejects(raw.$transaction(tx => admitServiceAppointment(tx, command, { leaseOwner: { ownerId: "wrong-owner", store: () => store } })), /hold_expired/);
          assert.equal(await raw.serviceAppointment.count({ where: { idempotencyKey: command.idempotencyKey } }), 0);
          assert.equal(await raw.appointmentAudit.count({ where: { commandId: command.idempotencyKey } }), 0);
          assert.equal(await raw.outboxMessage.count({ where: { causationId: command.idempotencyKey } }), 0);
        }
        const result = await raw.$transaction(tx => admitServiceAppointment(tx, command, { leaseOwner,
          ...(holdEnabled ? {} : { leaseSelections: [] }) }));
        assert.equal(result.appointment.operationalStatus, "scheduled"); assert.equal(result.appointment.policyVersion, row.version);
        assert.equal(result.appointment.priceInCents, 5000); assert.equal(result.appointment.currency, "BRL");
        assert.deepEqual(result.appointment.policySnapshot, { holdEnabled, holdMinutes: holdEnabled ? 7 : null, paymentMode });
        if (confirmation.kind === "approved_order_unit") {
          assert.equal(result.appointment.orderId, confirmation.orderId); assert.equal(result.appointment.orderUnitId, confirmation.unitId);
          assert.equal(await raw.paymentIntent.count({ where: { merchantId: input.merchantId, sessionId: fixture.session.sessionId, status: "approved" } }), 1);
        } else {
          assert.equal(result.appointment.orderId, null); assert.equal(await raw.paymentIntent.count({ where: { merchantId: input.merchantId, sessionId: fixture.session.sessionId } }), 0);
        }
        assert.equal(await raw.appointmentAudit.count({ where: { commandId: command.idempotencyKey } }), 1);
        assert.equal(await raw.outboxMessage.count({ where: { causationId: command.idempotencyKey } }), 1);
        if (holdEnabled) { await service.release(input.merchantId, fixture.session.sessionId); assert.equal(await store.get(input.merchantId, fixture.session.sessionId), undefined); }
        else assert.equal(unusedClients.at(-1)!.status, "wait");
        const current = await raw.$transaction(tx => getProfessionalAvailability(tx, { merchantId: input.merchantId, professionalId: input.professionalId,
          productId: input.productId, variantId: input.variantId, fromDate: fixture.choice.date, toDate: fixture.choice.date, now: new Date() }));
        assert.equal(current.slots.some(slot => slot.startsAt === fixture.choice.startsAt), false);
      });
    }
    await t.test("the actual service refuses a changed cart or buyer before creating its lease", async () => {
      const policy = await raw.serviceBusinessPolicy.update({ where: { merchantId: input.merchantId }, data: { holdEnabled: true, holdMinutes: 7, version: { increment: 1 } } });
      const fixture = await seedCheckout("changed-server-cart", dateAt(10), policy.version), service = new ServiceSlotHoldsService(raw, store);
      const before = await raw.checkoutSession.findUniqueOrThrow({ where: { merchantId_sessionId: { merchantId: input.merchantId, sessionId: fixture.session.sessionId } } });
      for (const changed of [{ ...fixture.session, globalUserId: "different-buyer" }, { ...fixture.session, cart: { ...fixture.session.cart, total: 1 } }])
        await assert.rejects(service.acquire(changed), /checkout_service_slot_changed/);
      assert.deepEqual(await raw.checkoutSession.findUnique({ where: { id: before.id } }), before);
      assert.equal(await store.get(input.merchantId, fixture.session.sessionId), undefined);
    });
    await t.test("a checkout quote captures its clock after an observed professional wait", async () => {
      const policy = await raw.serviceBusinessPolicy.findUniqueOrThrow({ where: { merchantId: input.merchantId } });
      const fixture = await seedCheckout("checkout-clock-wait", dateAt(11), policy.version);
      let current = new Date(fixture.choice.startsAt); current = new Date(current.getTime() - 60_000);
      let reads = 0, release!: () => void, ready!: () => void, rejectReady!: (error: unknown) => void, holderPid = 0;
      const locked = new Promise<void>((resolve, reject) => { ready = resolve; rejectReady = reject; }), allowCommit = new Promise<void>(resolve => { release = resolve; });
      const holder = raw.$transaction(async tx => { await lockServiceProfessional(tx, input.merchantId, input.professionalId);
        [{ pid: holderPid }] = await tx.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid() AS pid`; ready(); await allowCommit; });
      void holder.catch(rejectReady);
      let quote: ReturnType<typeof readProfessionalCheckout> | undefined, settled = false;
      try {
        await locked; assert.ok(Number.isInteger(holderPid) && holderPid > 0);
        quote = raw.$transaction(tx => readProfessionalCheckout(tx, fixture.session, () => { reads++; return current; }));
        void quote.then(() => { settled = true; }, () => { settled = true; });
        const deadline = Date.now() + 2000; let waiting = false;
        do { waiting = Number(await db.sql(`SELECT count(*) FROM pg_stat_activity WHERE ${holderPid}=ANY(pg_blocking_pids(pid))
          AND wait_event_type='Lock' AND position('service_professionals' in query)>0 AND position('FOR UPDATE' in upper(query))>0;`)) > 0; } while (!waiting && Date.now() < deadline);
        assert.equal(waiting, true); assert.equal(settled, false); assert.equal(reads, 0);
        current = new Date(fixture.choice.startsAt);
      } finally { release(); await Promise.allSettled([holder, ...(quote ? [quote] : [])]); }
      await holder; assert.ok(quote); await assert.rejects(quote, /service_slot_unavailable/); assert.equal(reads, 1);
      assert.equal(await store.get(input.merchantId, fixture.session.sessionId), undefined);
      assert.equal(await raw.serviceAppointment.count({ where: { startsAt: new Date(fixture.choice.startsAt) } }), 0);
    });
    await t.test("a lease for another professional cannot be relabelled with the selected display identity", async () => {
      const policy = await raw.serviceBusinessPolicy.findUniqueOrThrow({ where: { merchantId: input.merchantId } });
      const fixture = await seedCheckout("forged-canonical-lease", dateAt(12), policy.version), professionalId = "booking-lease-other-professional";
      await raw.serviceProfessional.create({ data: { id: professionalId, merchantId: input.merchantId, publicName: "Synthetic lease resource", timeZone: "UTC", isActive: true, isPublished: true } });
      await raw.professionalService.create({ data: { merchantId: input.merchantId, professionalId, productId: input.productId } });
      const forged = { ...fixture.choice, professionalId }, leaseOwner = { ownerId: fixture.session.sessionId, store: () => store };
      await acquireProfessionalLease(input.merchantId, [forged], { holdEnabled: true, holdMinutes: 7, paymentMode: "at_attendance" }, leaseOwner);
      assert.ok(await store.get(input.merchantId, fixture.session.sessionId));
      await assert.rejects(raw.$transaction(tx => admitServiceAppointment(tx, fixture.request, { leaseOwner, leaseSelections: [forged] })), /service_hold_selection_mismatch/);
      assert.equal(await raw.serviceAppointment.count({ where: { idempotencyKey: fixture.request.idempotencyKey } }), 0);
      assert.equal(await raw.appointmentAudit.count({ where: { commandId: fixture.request.idempotencyKey } }), 0);
      assert.equal(await raw.outboxMessage.count({ where: { causationId: fixture.request.idempotencyKey } }), 0);
      await store.release(input.merchantId, fixture.session.sessionId);
    });
  } finally {
    const errors: unknown[] = [];
    try { if (prisma) await prisma.$disconnect(); } catch (error) { errors.push(error); }
    for (const client of unusedClients) client.disconnect();
    try { if (redis) { try { await redis.quit(); } finally { redis.disconnect(); } } } catch (error) { errors.push(error); }
    try { if (redisOwner) await redisOwner.dispose(); } catch (error) { errors.push(error); }
    try { await db.dispose(); assert.deepEqual(db.bridgeStatus(), { listening: false, sockets: 0, children: 0 }); } catch (error) { errors.push(error); }
    if (errors.length) throw new AggregateError(errors, "owned_service_holds_cleanup_failed");
  }
  assert.deepEqual(db.bridgeStatus(), { listening: false, sockets: 0, children: 0 });
});
