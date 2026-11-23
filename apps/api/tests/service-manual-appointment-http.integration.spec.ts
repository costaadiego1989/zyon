import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { createProfessionalHttpFixture } from "./service-professional-http-fixture.mjs";
import { SERVICE_LOCAL_TEST_MS } from "./service-test-startup.mjs";
import { createManualServiceAppointmentWithin, type ManualServiceAppointmentCommand } from "../src/modules/operations/application/create-manual-service-appointment.use-case.js";
import { admitServiceAppointment } from "../src/shared/bookings/service-appointment-admission.service.js";

test("T31 HTTP and SQL", { timeout: SERVICE_LOCAL_TEST_MS }, async t => {
  const f = await createProfessionalHttpFixture();
  try {
    const { prisma, runtime } = f;
    const submit = async (c: any, body: unknown = c.command, auth: any = c.auth) => {
      const correlationId = randomUUID(), response = await fetch(runtime.apiOrigin + "/merchants/" + c.auth.merchant_id + "/service-appointments/manual", {
        method: "POST", redirect: "error", signal: AbortSignal.timeout(15_000), headers: {
          "content-type": "application/json", "idempotency-key": randomUUID(), "x-correlation-id": correlationId,
          ...(auth ? { authorization: "Bearer " + auth.access_token } : {}),
        }, body: JSON.stringify(body),
      });
      const result = { status: response.status, body: await response.json() };
      if (auth && [201, 400, 404, 409, 500].includes(response.status)) {
        const deadline = Date.now() + 5000; let audit;
        do { audit = await prisma.merchantAuditEvent.findFirst({ where: { merchantId: auth.merchant_id, correlationId } }); } while (!audit && Date.now() < deadline);
        assert.ok(audit, "actual manual handler HTTP audit required"); assert.equal(audit.actorId, auth.user_id);
        assert.equal(audit.outcome, response.status < 400 ? "success" : "failed"); assert.equal(audit.metadata.statusCode, response.status);
      }
      return result;
    };
    const prepare = async (suffix: string, paymentMode: "online" | "at_attendance" = "at_attendance", holdEnabled = false, oneOff = true) => {
      const auth = await f.register("services", "t31-" + suffix), merchantId = auth.merchant_id;
      const policy = await f.request("/merchants/me/service-business-policy", { expectedVersion: 0, paymentMode, holdEnabled,
        ...(holdEnabled ? { holdMinutes: 4 } : {}), admissionsEnabled: true }, auth, "PUT"); assert.equal(policy.status, 200, JSON.stringify(policy));
      // Canonical persisted catalogue fixture; the actual catalogue writer has its own existing gates.
      const product = await prisma.product.create({ data: { merchantId, name: "Manual public service", type: "service", isActive: true,
        metadata: { serviceSchedule: { timeZone: "UTC", durationMinutes: 20, slots: [] } }, variants: { create: {
          sku: "t31-" + suffix, isActive: true, price: { create: { basePriceInCents: 5000, currency: "BRL" } },
        } } }, include: { variants: true } });
      const created = await f.request(f.path(auth), { publicName: "Manual professional", timeZone: "America/Sao_Paulo", isPublished: true, productIds: [product.id] }, auth);
      assert.equal(created.status, 201, JSON.stringify(created));
      const grade = await f.request(f.path(auth) + "/" + created.body.id + "/availability", { expectedVersion: created.body.version, timeZone: "America/Sao_Paulo",
        rows: Array.from({ length: 7 }, (_, weekday) => ({ weekday, startMinute: 420, endMinute: 540 })) }, auth, "PUT");
      assert.equal(grade.status, 200, JSON.stringify(grade));
      const professional = await prisma.serviceProfessional.findUniqueOrThrow({ where: { id: created.body.id } });
      const date = new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10);
      const command: ManualServiceAppointmentCommand = { commandId: "manual-" + suffix, professionalId: professional.id, productId: product.id,
        variantId: product.variants[0].id, expectedProfessionalVersion: professional.version, expectedPolicyVersion: policy.body.version,
        startsAt: date + (oneOff ? "T14:00:00.000Z" : "T10:00:00.000Z"),
        customer: { kind: "contact", name: "Synthetic manual customer", email: "manual@example.test" },
        ...(oneOff ? { explicitOneOff: { reason: "Private manual operator note" } } : {}) };
      return { auth, merchantId, policy: policy.body, professional, product, date, command };
    };
    const state = async (c: any) => ({
      appointments: await prisma.serviceAppointment.count({ where: { merchantId: c.merchantId } }),
      balances: await prisma.appointmentPayment.count({ where: { merchantId: c.merchantId } }),
      audits: await prisma.appointmentAudit.count({ where: { merchantId: c.merchantId } }),
      bookingOutbox: await prisma.outboxMessage.count({ where: { merchantId: c.merchantId, producer: "service-booking" } }),
      exceptions: await prisma.availabilityException.count({ where: { merchantId: c.merchantId } }),
      professionalVersion: (await prisma.serviceProfessional.findUniqueOrThrow({ where: { id: c.professional.id } })).version,
      intents: await prisma.paymentIntent.count({ where: { merchantId: c.merchantId } }),
      orders: await prisma.completedOrder.count({ where: { merchantId: c.merchantId } }),
      inventory: await prisma.inventoryMovement.count({ where: { merchantId: c.merchantId } }),
    });
    await t.test("served manual command commits explicit one-off, occupied appointment and pending local balance", async () => {
      const c = await prepare("local"), result = await submit(c); assert.equal(result.status, 201, JSON.stringify(result)); assert.equal(result.body.replayed, false);
      const a = await prisma.serviceAppointment.findUniqueOrThrow({ where: { id: result.body.appointment.id }, include: { payments: true } });
      assert.equal(a.origin, "manual"); assert.equal(a.operationalStatus, "scheduled"); assert.equal(a.startsAt.toISOString(), c.command.startsAt);
      assert.equal(a.endsAt.toISOString(), c.date + "T14:20:00.000Z"); assert.equal(a.timeZone, "America/Sao_Paulo"); assert.equal(a.priceInCents, 5000); assert.equal(a.currency, "BRL");
      assert.equal(a.buyerGlobalUserId, null); assert.deepEqual(a.customerSnapshot, { name: "Synthetic manual customer", email: "manual@example.test" });
      assert.equal(a.payments.length, 1); assert.equal(a.payments[0].status, "pending"); assert.equal(a.payments[0].receivedAt, null);
      assert.equal(a.availabilityExceptionId, result.body.availabilityExceptionId);
      const exception = await prisma.availabilityException.findUniqueOrThrow({ where: { id: a.availabilityExceptionId! } });
      assert.equal(exception.kind, "one_off"); assert.equal(exception.actorId, c.auth.user_id); assert.equal(exception.reason, "Private manual operator note");
      const audit = await prisma.appointmentAudit.findUniqueOrThrow({ where: { merchantId_commandId: { merchantId: c.merchantId, commandId: c.command.commandId } } });
      assert.equal(audit.action, "manual_create"); assert.equal(audit.actorId, c.auth.user_id); assert.equal(audit.origin, "manual");
      const outbox = await prisma.outboxMessage.findMany({ where: { merchantId: c.merchantId, producer: "service-booking" } });
      for (const secret of ["manual@example.test", "Private manual operator note"]) assert.equal(JSON.stringify(outbox).includes(secret), false);
      assert.deepEqual(await state(c), { appointments: 1, balances: 1, audits: 1, bookingOutbox: 1, exceptions: 1,
        professionalVersion: c.professional.version + 1, intents: 0, orders: 0, inventory: 0 });
    });
    await t.test("all four existing payment/hold policies preserve local-unpaid versus online-pending", async () => {
      for (const mode of ["online", "at_attendance"] as const) for (const hold of [false, true]) {
        const c = await prepare(mode + "-" + hold, mode, hold), result = await submit(c); assert.equal(result.status, 201, JSON.stringify(result));
        const a = await prisma.serviceAppointment.findUniqueOrThrow({ where: { id: result.body.appointment.id }, include: { payments: true } });
        assert.equal(a.operationalStatus, mode === "online" ? "pending" : "scheduled"); assert.equal(a.confirmedAt === null, mode === "online");
        assert.equal(a.payments.length, mode === "online" ? 0 : 1); assert.equal(a.policySnapshot.holdEnabled, hold); assert.equal(a.policySnapshot.paymentMode, mode);
        const s = await state(c); assert.equal(s.intents, 0); assert.equal(s.orders, 0); assert.equal(s.inventory, 0);
      }
    });
    await t.test("human session, operator role, canonical mode and tenant/body authority are enforced", async () => {
      const c = await prepare("authority"), before = await state(c);
      assert.equal((await submit(c, c.command, null)).status, 401); assert.equal((await submit(c, c.command, f.foreign)).status, 403);
      assert.equal((await submit({ ...c, auth: f.staff }, c.command, f.staff)).status, 403);
      assert.equal((await submit({ ...c, auth: f.products }, c.command, f.products)).status, 403);
      const foreignBody = await submit(c, { ...c.command, merchantId: f.foreign.merchant_id });
      assert.equal(foreignBody.status, 403);
      assert.equal(foreignBody.body.code, "tenant_mismatch_body");
      for (const extra of [{ actorId: "injected" }, { buyerGlobalUserId: "injected" }, { priceInCents: 1 }, { timeZone: "UTC" }, { holdOwnerId: "injected" }])
        assert.equal((await submit(c, { ...c.command, ...extra })).status, 400);
      assert.deepEqual(await state(c), before);
    });
    await t.test("known customer is scoped by existing tenant membership and minimum contact remains mandatory", async () => {
      const c = await prepare("customer"), now = new Date();
      await prisma.checkoutSession.create({ data: { merchantId: c.merchantId, sessionId: "known-manual", globalUserId: "known-manual-buyer", conversationId: "known-conversation",
        cart: { items: [], currency: "BRL", total: 0 }, customer: { fullName: "Known tenant customer", phone: "+5521999990000" }, createdAt: now, updatedAt: now } });
      await prisma.checkoutSession.create({ data: { merchantId: f.foreign.merchant_id, sessionId: "foreign-manual", globalUserId: "foreign-manual-buyer", conversationId: "foreign-conversation",
        cart: { items: [], currency: "BRL", total: 0 }, customer: { fullName: "Foreign customer", phone: "+5521999990000" }, createdAt: now, updatedAt: now } });
      const before = await state(c);
      assert.equal((await submit(c, { ...c.command, customer: { kind: "known", customerId: "foreign-manual-buyer" } })).status, 404);
      assert.equal((await submit(c, { ...c.command, customer: { kind: "contact", name: "Only name" } })).status, 400); assert.deepEqual(await state(c), before);
      const result = await submit(c, { ...c.command, customer: { kind: "known", customerId: "known-manual-buyer" } }); assert.equal(result.status, 201, JSON.stringify(result));
      const a = await prisma.serviceAppointment.findUniqueOrThrow({ where: { id: result.body.appointment.id } });
      assert.equal(a.buyerGlobalUserId, "known-manual-buyer"); assert.deepEqual(a.customerSnapshot, { name: "Known tenant customer", phone: "+5521999990000" });
    });
    await t.test("concurrent same-command retries and later replay retain one receipt and immutable financial history", async () => {
      const c = await prepare("replay"), replies = await Promise.all([submit(c), submit(c)]);
      for (const r of replies) assert.equal(r.status, 201, JSON.stringify(r)); assert.deepEqual(replies.map(r => r.body.replayed).sort(), [false, true]);
      assert.equal(replies[0].body.appointment.id, replies[1].body.appointment.id);
      const id = replies[0].body.appointment.id, receivedAt = new Date();
      // Explicit later synthetic financial fact; this is not provider/receipt proof.
      await prisma.appointmentPayment.updateMany({ where: { appointmentId: id }, data: { status: "approved", receivedAt, version: { increment: 1 } } });
      const closed = await f.request("/merchants/me/service-business-policy", { expectedVersion: c.policy.version, paymentMode: "at_attendance", holdEnabled: false, admissionsEnabled: false }, c.auth, "PUT");
      assert.equal(closed.status, 200, JSON.stringify(closed));
      const before = await prisma.serviceAppointment.findUniqueOrThrow({ where: { id }, include: { payments: true } });
      const replay = await submit(c); assert.equal(replay.status, 201, JSON.stringify(replay)); assert.equal(replay.body.replayed, true);
      assert.deepEqual(await prisma.serviceAppointment.findUniqueOrThrow({ where: { id }, include: { payments: true } }), before);
      assert.equal((await submit(c, { ...c.command, startsAt: c.date + "T15:00:00.000Z" })).status, 409);
      const s = await state(c); assert.equal(s.appointments, 1); assert.equal(s.balances, 1); assert.equal(s.audits, 1); assert.equal(s.bookingOutbox, 1); assert.equal(s.exceptions, 1);
    });
    await t.test("stale policy/professional, foreign tuple and non-explicit out-of-grid selection leave no orphan", async () => {
      const c = await prepare("stale"), before = await state(c);
      const foreign = await prisma.product.create({ data: { merchantId: f.foreign.merchant_id, name: "Foreign service tuple", type: "service",
        metadata: { serviceSchedule: { timeZone: "UTC", durationMinutes: 20, slots: [] } },
        variants: { create: { sku: "t31-foreign-tuple", price: { create: { basePriceInCents: 5000, currency: "BRL" } } } } }, include: { variants: true } });
      for (const change of [{ expectedPolicyVersion: c.policy.version + 1 }, { expectedProfessionalVersion: c.professional.version + 1 },
        { productId: foreign.id, variantId: foreign.variants[0].id }, { productId: "missing-product" }, { variantId: "missing-variant" }, { explicitOneOff: undefined }]) {
        const denied = await submit(c, { ...c.command, ...change }); assert.ok([400, 404, 409].includes(denied.status), JSON.stringify(denied)); assert.deepEqual(await state(c), before);
      }
    });
    await t.test("existing canonical block and confirmed capacity prevent an explicit one-off", async () => {
      const c = await prepare("blocked"), startsAt = new Date(c.command.startsAt), endsAt = new Date(startsAt.getTime() + 20 * 60_000);
      const block = await prisma.availabilityException.create({ data: { merchantId: c.merchantId, professionalId: c.professional.id,
        kind: "block", startsAt, endsAt, timeZone: "UTC", actorId: c.auth.user_id } });
      const before = await state(c); assert.equal((await submit(c)).status, 409); assert.deepEqual(await state(c), before);
      await prisma.availabilityException.delete({ where: { id: block.id } });
      assert.equal((await submit(c)).status, 201);
      const occupied = await state(c); assert.equal((await submit(c, { ...c.command, commandId: "manual-overlap", expectedProfessionalVersion: occupied.professionalVersion })).status, 409);
      assert.deepEqual(await state(c), occupied);
    });
    await t.test("actual pending-balance failure rolls back one-off/version/appointment/audit/outbox", async () => {
      const c = await prepare("rollback"), before = await state(c);
      await runtime.db.sql("CREATE FUNCTION t31_fail_balance() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic_t31_balance_failure'; END $$; CREATE TRIGGER t31_fail_balance BEFORE INSERT ON appointment_payments FOR EACH ROW EXECUTE FUNCTION t31_fail_balance();");
      try { assert.equal((await submit(c)).status, 500); assert.deepEqual(await state(c), before); }
      finally { await runtime.db.sql("DROP TRIGGER IF EXISTS t31_fail_balance ON appointment_payments; DROP FUNCTION IF EXISTS t31_fail_balance();"); }
    });
    await t.test("real manual and buyer admission queue on the same merchant and cannot both occupy one interval", async () => {
      const c = await prepare("capacity-race", "at_attendance", false, false);
      let release!: () => void, ready!: () => void, rejectReady!: (error: unknown) => void, holderPid = 0, buyerPid = 0;
      const entered = new Promise<void>((resolve, reject) => { ready = resolve; rejectReady = reject; }), barrier = new Promise<void>(resolve => { release = resolve; });
      const holder = prisma.$transaction(async (tx: any) => { await tx.$queryRaw`SELECT id FROM merchants WHERE id=${c.merchantId} FOR UPDATE`;
        [{ pid: holderPid }] = await tx.$queryRaw`SELECT pg_backend_pid() AS pid`; ready(); await barrier; });
      void holder.catch(rejectReady); let manual: Promise<any> | undefined, buyer: Promise<any> | undefined;
      try {
        await entered; manual = submit(c);
        buyer = prisma.$transaction(async (tx: any) => {
          [{ pid: buyerPid }] = await tx.$queryRaw`SELECT pg_backend_pid() AS pid`;
          return admitServiceAppointment(tx, { merchantId: c.merchantId, professionalId: c.professional.id,
          productId: c.product.id, variantId: c.command.variantId, date: c.date, startsAt: c.command.startsAt, endsAt: c.date + "T10:20:00.000Z",
          professionalVersion: c.professional.version, policyVersion: c.policy.version, priceInCents: 5000, currency: "BRL",
          customer: { name: "Synthetic buyer contender", email: "contender@example.test" }, buyerGlobalUserId: "synthetic-buyer-contender",
          actorId: "synthetic-buyer-contender", origin: "storefront", idempotencyKey: "t31-buyer-contender", confirmation: { kind: "at_attendance" } });
        });
        void buyer.catch(() => {}); const deadline = Date.now() + 2000; let waiters: Array<{ pid: number }> = [];
        do {
          // PostgreSQL may queue the second writer behind the first waiting
          // writer. Retain the exact holder's transitive blocking chain.
          waiters = await prisma.$queryRaw`WITH RECURSIVE blocked(pid) AS (
            SELECT a.pid FROM pg_stat_activity a WHERE ${holderPid}=ANY(pg_blocking_pids(a.pid))
            UNION SELECT a.pid FROM pg_stat_activity a JOIN blocked b ON b.pid=ANY(pg_blocking_pids(a.pid))
          ) SELECT DISTINCT pid FROM blocked`;
          if (waiters.length < 2) await new Promise<void>(resolve => setImmediate(resolve));
        } while (waiters.length < 2 && Date.now() < deadline);
        assert.ok(buyerPid > 0); assert.ok(waiters.some(row => row.pid === buyerPid));
        assert.ok(waiters.length >= 2, "both contenders must queue behind the exact holder"); release(); await holder;
        const [m, b] = await Promise.allSettled([manual, buyer]); assert.equal(m.status, "fulfilled");
        if (m.status !== "fulfilled") assert.fail("HTTP transport must settle"); assert.ok([201, 409].includes(m.value.status), JSON.stringify(m.value));
        assert.equal(Number(m.value.status === 201) + Number(b.status === "fulfilled"), 1); assert.equal((await state(c)).appointments, 1);
      } finally { release(); await Promise.allSettled([holder, ...(manual ? [manual] : []), ...(buyer ? [buyer] : [])]); }
    });
    for (const resource of ["merchant", "professional"] as const) await t.test("fresh manual clock follows the exact " + resource + " lock wait", async () => {
      const c = await prepare("clock-" + resource, "at_attendance", false, false), actor = { merchantId: c.merchantId, userId: c.auth.user_id, role: "owner" };
      let release!: () => void, ready!: () => void, rejectReady!: (error: unknown) => void, holderPid = 0, clockCalls = 0;
      let current = new Date(Date.parse(c.command.startsAt) - 1000);
      const entered = new Promise<void>((resolve, reject) => { ready = resolve; rejectReady = reject; }), barrier = new Promise<void>(resolve => { release = resolve; });
      const holder = prisma.$transaction(async (tx: any) => {
        if (resource === "merchant") await tx.$queryRaw`SELECT id FROM merchants WHERE id=${c.merchantId} FOR UPDATE`;
        else await tx.$queryRaw`SELECT id FROM service_professionals WHERE merchant_id=${c.merchantId} AND id=${c.professional.id} FOR UPDATE`;
        [{ pid: holderPid }] = await tx.$queryRaw`SELECT pg_backend_pid() AS pid`; ready(); await barrier;
      });
      void holder.catch(rejectReady); let pending: Promise<unknown> | undefined;
      try {
        await entered; pending = prisma.$transaction((tx: any) => createManualServiceAppointmentWithin(tx, actor, c.command, {
          clock: () => { clockCalls++; return current; }, store: () => assert.fail("holds disabled"),
        })); void pending.catch(() => {});
        const deadline = Date.now() + 2000; let blocked = false;
        do { const rows = await prisma.$queryRaw`SELECT pid FROM pg_stat_activity WHERE wait_event_type='Lock' AND ${holderPid}=ANY(pg_blocking_pids(pid))`;
          blocked = rows.length > 0; if (!blocked) await new Promise<void>(resolve => setImmediate(resolve)); } while (!blocked && Date.now() < deadline);
        assert.equal(blocked, true); assert.equal(clockCalls, 0); current = new Date(Date.parse(c.command.startsAt) + 1); release(); await holder;
        await assert.rejects(pending, /service_slot_unavailable/); assert.equal(clockCalls, 1); assert.equal((await state(c)).appointments, 0);
      } finally { release(); await Promise.allSettled([holder, ...(pending ? [pending] : [])]); }
    });
    assert.equal(runtime.evidence().providerCalls, 0);
  } finally {
    const errors: unknown[] = [];
    try { await f.prisma.$disconnect(); } catch (error) { errors.push(error); }
    try { await f.runtime.close(); } catch (error) { errors.push(error); }
    if (errors.length) throw new AggregateError(errors, "owned_manual_http_cleanup_failed");
  }
  assert.deepEqual(f.runtime.cleanupEvidence(), { appClosed: true, remainingContainers: 0, remainingBridgeSockets: 0 });
});
