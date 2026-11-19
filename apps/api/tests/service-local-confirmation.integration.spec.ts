import assert from "node:assert/strict";
import { test } from "node:test";
import { PrismaClient } from "@prisma/client";
import { createDisposablePostgres } from "./local-disposable-postgres.mjs";
import { bootstrapServiceSchema } from "./service-migration-bootstrap.mjs";
import { assertServiceArtifacts } from "./service-test-artifacts.mjs";
import { SERVICE_LOCAL_TEST_MS } from "./service-test-startup.mjs";
import { seedServiceBookingFixture } from "./service-booking-fixtures.js";
import { confirmServiceAppointment, confirmServiceAppointmentFromEmbed } from "../src/modules/checkout/application/confirm-service-appointment.use-case.js";
import { ServiceSlotHoldsService } from "../src/shared/bookings/service-slot-holds.service.js";
import { toCheckoutSession } from "../src/modules/checkout/domain/services/checkout-session-projection.js";
import { paymentCartFingerprint } from "../src/modules/checkout/domain/services/payment-cart-fingerprint.js";
import type { CheckoutSession } from "@zyon/shared-types";

test("T30", { timeout: SERVICE_LOCAL_TEST_MS }, async t => {
  assertServiceArtifacts();
  const db = await createDisposablePostgres({ transport: "loopback-exec" });
  let raw: PrismaClient | undefined;
  try {
    await db.sql(`CREATE TABLE synthetic_native_marker(run_id TEXT PRIMARY KEY); INSERT INTO synthetic_native_marker VALUES ('${db.runId}');`);
    await bootstrapServiceSchema(db);
    raw = new PrismaClient({ datasources: { db: { url: db.prismaUrl } } });
    const prisma = raw, now = new Date("2030-01-01T09:00:00Z");
    await seedServiceBookingFixture(prisma, now);
    let cacheCalls = 0;
    const noStore = () => { cacheCalls++; throw new Error("synthetic_redis_offline"); };
    const checkout = async (sessionId: string, date: string) => {
      const cart: CheckoutSession["cart"] = { currency: "BRL", total: 50, items: [{ sku: "booking-short", product_id: "booking-short",
        variantId: "booking-short-variant", name: "Synthetic service", productType: "service", fulfillmentStrategy: "scheduled_service", price: 50,
        quantity: 1, fulfillmentSchedule: { slotId: "display-slot", date, startsAt: date + "T10:00:00.000Z", endsAt: date + "T10:20:00.000Z",
          timeZone: "UTC", durationMinutes: 20, professionalId: "booking-professional", professionalVersion: 1, policyVersion: 1 } }] };
      await prisma.checkoutSession.create({ data: { merchantId: "booking-services", sessionId, globalUserId: "synthetic-buyer",
        conversationId: "conversation-" + sessionId, cart: JSON.parse(JSON.stringify(cart)),
        createdAt: now, updatedAt: now,
        customer: { fullName: "Synthetic buyer", phone: "+5521999990000" } } });
      return { buyer: { merchantId: "booking-services", sessionId, globalUserId: "synthetic-buyer", origin: "whatsapp" as const },
        command: { commandId: "confirm-" + sessionId, cartFingerprint: paymentCartFingerprint({ cart }) } };
    };
    const confirm = (value: Awaited<ReturnType<typeof checkout>>) => prisma.$transaction(tx =>
      confirmServiceAppointment(tx, value.buyer, value.command, { clock: () => now, store: noStore }));
    await t.test("local confirmation creates occupied capacity and unpaid balance without provider/cache", async () => {
      const context = await checkout("local-first", "2030-01-02");
      const result = await confirm(context), appointment = result.appointments[0];
      assert.equal(result.replayed, false); assert.equal(appointment.operationalStatus, "scheduled");
      assert.equal(appointment.payments.length, 1); const payment = appointment.payments[0];
      assert.equal(payment.mode, "at_attendance"); assert.equal(payment.status, "pending");
      assert.equal(payment.amountCents, 5000); assert.equal(payment.receivedAt, null); assert.equal(payment.paymentIntentId, null);
      assert.equal(payment.provider, null); assert.equal(payment.providerPaymentId, null);
      assert.equal(cacheCalls, 0); assert.equal(await prisma.paymentIntent.count(), 0); assert.equal(await prisma.inventoryMovement.count(), 0);
      const replay = await confirm(context);
      assert.equal(replay.replayed, true); assert.equal(replay.appointments[0].id, appointment.id);
      assert.equal(await prisma.appointmentPayment.count(), 1);
      assert.equal(await prisma.appointmentAudit.count({ where: { commandId: context.command.commandId } }), 1);
      assert.equal(await prisma.outboxMessage.count({ where: { causationId: context.command.commandId } }), 1);
      await prisma.appointmentPayment.update({ where: { id: payment.id }, data: { status: "approved", receivedAt: now, version: 2 } });
      await prisma.serviceBusinessPolicy.update({ where: { merchantId: context.buyer.merchantId }, data: { admissionsEnabled: false } });
      const later = await confirm(context);
      assert.equal(later.appointments[0].payments[0].status, "approved", "retry cannot reset later financial state");
      assert.equal(later.appointments[0].payments[0].version, 2);
      const stored = await prisma.checkoutSession.findUniqueOrThrow({ where: { merchantId_sessionId: {
        merchantId: context.buyer.merchantId, sessionId: context.buyer.sessionId } } });
      const session = toCheckoutSession(stored), holds = new ServiceSlotHoldsService(prisma);
      assert.equal(await holds.isCommittedCheckout(session), true);
      assert.deepEqual(await holds.state(session), { requires_hold: false, service_slot_hold: null });
      assert.equal(await holds.acquire(session), undefined);
      assert.equal(await holds.prepareProfessionalCheckout(session), undefined);
      await assert.rejects(holds.assertBeforePayment(session), /already_confirmed/);
      await prisma.serviceBusinessPolicy.update({ where: { merchantId: context.buyer.merchantId }, data: { admissionsEnabled: true } });
    });
    await t.test("concurrent distinct buyer checkouts compete through the same professional lock", async () => {
      const a = await checkout("local-race-a", "2030-01-03"), b = await checkout("local-race-b", "2030-01-03");
      const result = await Promise.allSettled([confirm(a), confirm(b)]);
      assert.equal(result.filter(value => value.status === "fulfilled").length, 1);
      const rejected = result.filter(value => value.status === "rejected"); assert.equal(rejected.length, 1);
      assert.match(String(rejected[0].reason), /service_slot_unavailable/);
      assert.equal(await prisma.serviceAppointment.count({ where: { startsAt: new Date("2030-01-03T10:00:00Z") } }), 1);
    });
    await t.test("buyer, summary, policy and command mismatches cannot leave a partial appointment", async () => {
      const context = await checkout("local-negatives", "2030-01-04");
      await assert.rejects(confirm({ ...context, buyer: { ...context.buyer, globalUserId: "foreign-buyer" } }), /buyer_mismatch/);
      await assert.rejects(confirm({ ...context, command: { ...context.command, cartFingerprint: "a".repeat(64) } }), /summary_changed/);
      await prisma.serviceBusinessPolicy.update({ where: { merchantId: context.buyer.merchantId }, data: { version: 2 } });
      await assert.rejects(confirm(context), /service_policy_changed/);
      await prisma.serviceBusinessPolicy.update({ where: { merchantId: context.buyer.merchantId }, data: { version: 1, paymentMode: "online" } });
      await assert.rejects(confirm(context), /online_payment_required/);
      await prisma.serviceBusinessPolicy.update({ where: { merchantId: context.buyer.merchantId }, data: { paymentMode: "at_attendance" } });
      assert.equal(await prisma.serviceAppointment.count({ where: { startsAt: new Date("2030-01-04T10:00:00Z") } }), 0);
      assert.equal(await prisma.appointmentAudit.count({ where: { commandId: context.command.commandId } }), 0);
      assert.equal(await prisma.outboxMessage.count({ where: { causationId: context.command.commandId } }), 0);
    });
    await t.test("one failed unpaid-balance write rolls appointment, audit and outbox back", async () => {
      const context = await checkout("local-rollback", "2030-01-05");
      await db.sql(`CREATE FUNCTION reject_local_balance() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic_local_balance_failure'; END $$;
        CREATE TRIGGER reject_local_balance BEFORE INSERT ON appointment_payments FOR EACH ROW EXECUTE FUNCTION reject_local_balance();`);
      await assert.rejects(confirm(context), /synthetic_local_balance_failure/);
      assert.equal(await prisma.serviceAppointment.count({ where: { startsAt: new Date("2030-01-05T10:00:00Z") } }), 0);
      assert.equal(await prisma.appointmentAudit.count({ where: { commandId: context.command.commandId } }), 0);
      assert.equal(await prisma.outboxMessage.count({ where: { causationId: context.command.commandId } }), 0);
      await db.sql("DROP TRIGGER reject_local_balance ON appointment_payments; DROP FUNCTION reject_local_balance();");
    });
    await t.test("a root Prisma client cannot autocommit the composite confirmation", async () => {
      const fixture = await checkout("local-root-refusal", "2030-01-06");
      const before = { appointments: await prisma.serviceAppointment.count(), payments: await prisma.appointmentPayment.count(),
        audit: await prisma.appointmentAudit.count(), outbox: await prisma.outboxMessage.count() };
      await assert.rejects(confirmServiceAppointment(prisma, fixture.buyer, fixture.command, { clock: () => now, store: noStore }),
        /service_confirmation_transaction_required/);
      assert.deepEqual({ appointments: await prisma.serviceAppointment.count(), payments: await prisma.appointmentPayment.count(),
        audit: await prisma.appointmentAudit.count(), outbox: await prisma.outboxMessage.count() }, before);
    });
    for (const resource of ["merchant", "professional"] as const) await t.test("the clock after an exact " + resource + " wait can refuse the selected start", async () => {
      const fixture = await checkout("local-clock-" + resource, resource === "merchant" ? "2030-01-07" : "2030-01-08");
      const stored = await prisma.checkoutSession.findUniqueOrThrow({ where: { merchantId_sessionId: {
        merchantId: fixture.buyer.merchantId, sessionId: fixture.buyer.sessionId } } });
      const session = toCheckoutSession(stored), selected = session.cart.items[0]!.fulfillmentSchedule!;
      let locked!: () => void, rejectLock!: (error: unknown) => void, release!: () => void, holderPid = 0, clockCalls = 0, fresh = now;
      const hasLock = new Promise<void>((resolve, reject) => { locked = resolve; rejectLock = reject; });
      const releaseHolder = new Promise<void>(resolve => { release = resolve; });
      const holder = prisma.$transaction(async tx => {
        if (resource === "merchant") await tx.$queryRaw`SELECT id FROM merchants WHERE id = ${fixture.buyer.merchantId} FOR UPDATE`;
        else await tx.$queryRaw`SELECT id FROM service_professionals WHERE merchant_id = ${fixture.buyer.merchantId} AND id = ${"booking-professional"} FOR UPDATE`;
        [{ pid: holderPid }] = await tx.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid() AS pid`;
        locked(); await releaseHolder;
      });
      void holder.catch(rejectLock); let pending: Promise<unknown> | undefined;
      try {
        await hasLock; assert.ok(holderPid > 0);
        pending = prisma.$transaction(tx => confirmServiceAppointment(tx, fixture.buyer, fixture.command,
          { clock: () => { clockCalls++; return fresh; }, store: noStore }));
        void pending.catch(() => {});
        const deadline = Date.now() + 2000; let blocked = false;
        while (Date.now() < deadline) {
          const rows = await prisma.$queryRaw<Array<{ pid: number }>>`SELECT pid FROM pg_stat_activity WHERE wait_event_type = 'Lock'
            AND ${holderPid} = ANY(pg_blocking_pids(pid))`;
          if (rows.length) { blocked = true; break; }
          await new Promise<void>(resolve => setImmediate(resolve));
        }
        assert.equal(blocked, true); assert.equal(clockCalls, 0);
        fresh = new Date(Date.parse(selected.startsAt) + 1); release(); await holder;
        await assert.rejects(pending, /service_slot_unavailable/); assert.equal(clockCalls, 1);
        assert.equal(await prisma.appointmentAudit.count({ where: { commandId: fixture.command.commandId } }), 0);
        assert.equal(await prisma.serviceAppointment.count({ where: { startsAt: new Date(selected.startsAt) } }), 0);
        assert.equal(await prisma.outboxMessage.count({ where: { causationId: fixture.command.commandId } }), 0);
      } finally { release(); await Promise.allSettled([holder, ...(pending ? [pending] : [])]); }
    });
    await t.test("a valid embed capability can expire during the actual merchant wait", async () => {
      const fixture = await checkout("local-capability-expiry", "2030-01-09"), expiresAt = new Date("2030-01-09T09:59:59Z");
      const capability = { merchantId: fixture.buyer.merchantId, sessionId: fixture.buyer.sessionId,
        scope: "appointments:confirm" as const, allowedOrigin: "https://synthetic-confirmation.example.test", expiresAtUnix: expiresAt.getTime() / 1000 };
      let locked!: () => void, rejectLock!: (error: unknown) => void, release!: () => void, holderPid = 0, fresh = now, clockCalls = 0;
      const hasLock = new Promise<void>((resolve, reject) => { locked = resolve; rejectLock = reject; });
      const releaseHolder = new Promise<void>(resolve => { release = resolve; });
      const holder = prisma.$transaction(async tx => {
        await tx.$queryRaw`SELECT id FROM merchants WHERE id = ${fixture.buyer.merchantId} FOR UPDATE`;
        [{ pid: holderPid }] = await tx.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid() AS pid`;
        locked(); await releaseHolder;
      });
      void holder.catch(rejectLock); let pending: Promise<unknown> | undefined;
      try {
        await hasLock;
        pending = prisma.$transaction(tx => confirmServiceAppointmentFromEmbed(tx, capability, fixture.command,
          { clock: () => { clockCalls++; return fresh; }, store: noStore }));
        void pending.catch(() => {});
        const deadline = Date.now() + 2000; let blocked = false;
        while (Date.now() < deadline) {
          const rows = await prisma.$queryRaw<Array<{ pid: number }>>`SELECT pid FROM pg_stat_activity WHERE wait_event_type = 'Lock'
            AND ${holderPid} = ANY(pg_blocking_pids(pid))`;
          if (rows.length) { blocked = true; break; }
          await new Promise<void>(resolve => setImmediate(resolve));
        }
        assert.equal(blocked, true); assert.equal(clockCalls, 0);
        fresh = expiresAt; release(); await holder;
        await assert.rejects(pending, /embed_session_token_expired/); assert.equal(clockCalls, 1);
        assert.equal(await prisma.appointmentAudit.count({ where: { commandId: fixture.command.commandId } }), 0);
        assert.equal(await prisma.serviceAppointment.count({ where: { startsAt: new Date("2030-01-09T10:00:00Z") } }), 0);
        assert.equal(await prisma.outboxMessage.count({ where: { causationId: fixture.command.commandId } }), 0);
      } finally { release(); await Promise.allSettled([holder, ...(pending ? [pending] : [])]); }
    });
    await t.test("one post-lock instant timestamps capacity, pending balance, audit and outbox", async () => {
      const fixture = await checkout("local-clock-success", "2030-01-10"), fresh = new Date("2030-01-10T09:59:00Z");
      let clockCalls = 0;
      const result = await prisma.$transaction(tx => confirmServiceAppointment(tx, fixture.buyer, fixture.command,
        { clock: () => { clockCalls++; return fresh; }, store: noStore }));
      const appointment = result.appointments[0]; assert.equal(clockCalls, 3);
      assert.equal(appointment.confirmedAt?.toISOString(), fresh.toISOString());
      assert.equal(appointment.payments[0].createdAt.toISOString(), fresh.toISOString());
      assert.equal((await prisma.appointmentAudit.findUniqueOrThrow({ where: { merchantId_commandId: {
        merchantId: fixture.buyer.merchantId, commandId: fixture.command.commandId } } })).occurredAt.toISOString(), fresh.toISOString());
      assert.equal((await prisma.outboxMessage.findFirstOrThrow({ where: { causationId: fixture.command.commandId } })).occurredAt.toISOString(), fresh.toISOString());
      assert.equal(appointment.payments[0].status, "pending"); assert.equal(await prisma.paymentIntent.count(), 0);
      assert.equal(await prisma.inventoryMovement.count(), 0); assert.equal(cacheCalls, 0);
    });
  } finally {
    const errors: unknown[] = [];
    try { if (raw) await raw.$disconnect(); } catch (error) { errors.push(error); }
    try { await db.dispose(); assert.deepEqual(db.bridgeStatus(), { listening: false, sockets: 0, children: 0 }); } catch (error) { errors.push(error); }
    if (errors.length) throw new AggregateError(errors, "owned_local_confirmation_cleanup_failed");
  }
  assert.deepEqual(db.bridgeStatus(), { listening: false, sockets: 0, children: 0 });
});
