import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { createServiceOperationsHttpFixture } from "./service-operations-http.fixture.js";
import { SERVICE_LOCAL_TEST_MS } from "./service-test-startup.mjs";

// Real authenticated HTTP/AppModule/SQL. Only pre-existing financial/appointment
// preconditions are seeded; this file does not claim a real PSP transaction.
test("T37 HTTP integral local receipt and immutable financial history", { timeout: SERVICE_LOCAL_TEST_MS }, async t => {
  const f = await createServiceOperationsHttpFixture({ serviceReleaseFixture: "matching" });
  try {
    const control = await f.prepare("receipt-control");
    const original = await f.prisma.serviceAppointment.findUniqueOrThrow({ where: { id: control.appointment.id } });
    let serial = 0;
    // Reuse one actually admitted control. Synthetic distinct historical local
    // obligations keep negatives focused on receipt authority, not admission or
    // repeated setup HTTP. Existing auth/repository/rate limits remain intact.
    const seed = async (suffix: string) => {
      const id = randomUUID(), offset = ++serial * 86_400_000;
      const appointment = await f.prisma.serviceAppointment.create({ data: { ...original, id,
        startsAt: new Date(original.startsAt.getTime() + offset), endsAt: new Date(original.endsAt.getTime() + offset),
        idempotencyKey: "receipt-precondition:" + suffix, requestFingerprint: "synthetic-existing:" + suffix,
        orderId: null, orderUnitId: null, availabilityExceptionId: null } });
      const payment = await f.prisma.appointmentPayment.create({ data: { merchantId: original.merchantId, appointmentId: id,
        mode: "at_attendance", amountCents: 5000, currency: "BRL", status: "pending",
        idempotencyKey: "at-attendance:" + id, requestFingerprint: "synthetic-original-5000:" + suffix } });
      return { appointment, payment };
    };
    const balance = (appointmentId: string) => f.prisma.appointmentPayment.findFirstOrThrow({ where: { merchantId: original.merchantId, appointmentId, mode: "at_attendance" } });
    const path = (appointmentId: string) => f.prefix() + "/" + appointmentId + "/attendance-receipts";
    const body = (payment: any, commandId: string, extra: Record<string, unknown> = {}) => ({ paymentId: payment.id,
      expectedPaymentVersion: payment.version, amountCents: payment.amountCents, currency: payment.currency,
      paymentMethod: "Pix presencial", commandId, ...extra });
    const pay = (appointmentId: string, payment: any, commandId: string, extra: Record<string, unknown> = {}, auth: any = f.owner) =>
      f.request(path(appointmentId), body(payment, commandId, extra), auth);
    const snapshot = async (appointmentId: string) => {
      const actual = await f.snapshot(appointmentId), ids = actual.balances.map(p => p.id);
      return { ...actual, receipts: await f.prisma.attendanceReceipt.findMany({ where: { merchantId: original.merchantId,
        appointmentPaymentId: { in: ids } }, orderBy: { id: "asc" } }) };
    };
    let settled: Awaited<ReturnType<typeof balance>>;
    await t.test("owner records exact cents/method/source, trusted actor/server instant and one immutable audit/outbox", async () => {
      settled = await balance(original.id); const before = await snapshot(original.id);
      const [start] = await f.prisma.$queryRaw<Array<{ now: Date }>>`SELECT clock_timestamp() AS now`;
      const result = await pay(original.id, settled, "receipt-control-first"); assert.equal(result.status, 201, JSON.stringify(result));
      const [finish] = await f.prisma.$queryRaw<Array<{ now: Date }>>`SELECT clock_timestamp() AS now`;
      assert.equal(result.body.source, "recorded_at_attendance"); assert.equal(result.body.replayed, false);
      assert.equal(result.body.receipt.amountCents, 5000); assert.equal(result.body.receipt.currency, "BRL");
      assert.equal(result.body.receipt.operatorId, f.owner.user_id); assert.equal(result.body.receipt.paymentMethod, "Pix presencial");
      const time = Date.parse(result.body.receipt.receivedAt); assert.ok(time >= start.now.getTime() && time <= finish.now.getTime());
      const after = await snapshot(original.id); assert.deepEqual(after.appointment, before.appointment);
      assert.equal(after.receipts.length, 1); assert.equal(after.receipts[0].id, result.body.receipt.id);
      assert.equal(after.balances[0].status, "approved"); assert.equal(after.balances[0].version, 2);
      assert.equal(after.balances[0].receivedAt?.toISOString(), result.body.receipt.receivedAt);
      assert.equal(after.balances[0].paymentIntentId, null); assert.equal(after.balances[0].providerPaymentId, null);
      const audit = after.audits.find(a => a.action === "attendance_receipt"); assert.ok(audit);
      assert.equal(audit.actorId, f.owner.user_id); assert.equal(audit.version, before.appointment.version);
      assert.equal((audit.after as any).receiptId, result.body.receipt.id); assert.equal((audit.after as any).paymentVersion, 2);
      const events = after.events.filter(e => e.eventType === "service.payment.recorded_at_attendance"); assert.equal(events.length, 1);
      assert.deepEqual(events[0].payload, { appointmentId: original.id, appointmentVersion: before.appointment.version,
        paymentId: settled.id, paymentVersion: 2, receiptId: result.body.receipt.id });
      assert.equal(events[0].merchantId, original.merchantId); assert.equal(events[0].causationId, "receipt-control-first");
      assert.equal(JSON.stringify(result.body).includes("requestFingerprint"), false); assert.equal(JSON.stringify(result.body).includes("customerSnapshot"), false);
    });
    await t.test("same-key replay after a real attendance transition preserves original receipt and current operational state", async () => {
      const started = await f.request(f.prefix() + "/" + original.id + "/transitions", {
        action: "start_service", expectedVersion: original.version, commandId: "receipt-start-after-payment" }); assert.equal(started.status, 201);
      const before = await snapshot(original.id), result = await pay(original.id, settled!, "receipt-control-first");
      assert.equal(result.status, 201); assert.equal(result.body.replayed, true); assert.deepEqual(await snapshot(original.id), before);
      assert.equal(before.appointment.operationalStatus, "in_service");
      const mismatch = await pay(original.id, settled!, "receipt-control-first", { paymentMethod: "Dinheiro" }); assert.equal(mismatch.status, 409);
      const second = await pay(original.id, before.balances[0], "receipt-control-second"); assert.equal(second.status, 409);
      assert.deepEqual(await snapshot(original.id), before);
    });
    await t.test("authorized rescheduling changes the real balance; old fingerprint and later catalog price cannot replace it", async () => {
      const c = await f.prepare("receipt-repriced"), initial = await balance(c.appointment.id);
      await f.prisma.productPrice.update({ where: { variantId: c.command.variantId }, data: { basePriceInCents: 6000 } });
      const destination = { professionalId: c.professional.id, expectedProfessionalVersion: c.professional.version, startsAt: c.date + "T10:20:00.000Z" };
      const quote = await f.request(f.prefix() + "/" + c.appointment.id + "/reschedule-quote", { expectedVersion: c.appointment.version, destination });
      assert.equal(quote.status, 201, JSON.stringify(quote));
      const moved = await f.request(f.prefix() + "/" + c.appointment.id + "/reschedule", { commandId: "receipt-price-accept",
        expectedVersion: c.appointment.version, operatorRequestId: "receipt-price-operator", destination,
        policyHash: quote.body.quote.policyHash, acceptedQuoteHash: quote.body.quoteHash }); assert.equal(moved.status, 201, JSON.stringify(moved));
      const current = await balance(c.appointment.id); assert.equal(current.amountCents, 6000); assert.equal(current.version, initial.version + 1);
      assert.equal(current.requestFingerprint, initial.requestFingerprint);
      await f.prisma.productPrice.update({ where: { variantId: c.command.variantId }, data: { basePriceInCents: 9000 } });
      const before = await snapshot(c.appointment.id);
      assert.equal((await pay(c.appointment.id, initial, "receipt-stale-original")).status, 409);
      const result = await pay(c.appointment.id, current, "receipt-current-balance"); assert.equal(result.status, 201, JSON.stringify(result));
      assert.equal(result.body.receipt.amountCents, 6000); assert.equal(result.body.payment.version, current.version + 1);
      assert.deepEqual((await snapshot(c.appointment.id)).appointment, before.appointment);
    });
    await t.test("partial, overpayment, invalid cents/currency/method and stale version preserve all SQL facts", async () => {
      const c = await seed("invalid"), before = await snapshot(c.appointment.id);
      for (const [extra, status] of [[{ amountCents: 4999 }, 409], [{ amountCents: 5001 }, 409], [{ amountCents: 0 }, 400],
        [{ amountCents: 1.5 }, 400], [{ currency: "brl" }, 400], [{ paymentMethod: "" }, 400],
        [{ currency: "USD" }, 409], [{ expectedPaymentVersion: 2 }, 409]] as const) {
        const result = await pay(c.appointment.id, c.payment, "invalid-" + randomUUID(), { ...extra }); assert.equal(result.status, status, JSON.stringify(result));
        assert.deepEqual(await snapshot(c.appointment.id), before);
      }
    });
    await t.test("anonymous/Staff/foreign route and opaque IDs plus body authority are refused; parser-null has no writes", async () => {
      const c = await seed("scope"), other = await seed("another-payment"), before = await snapshot(c.appointment.id);
      assert.equal((await pay(c.appointment.id, c.payment, "scope-anonymous", {}, null)).status, 401);
      assert.equal((await pay(c.appointment.id, c.payment, "scope-staff", {}, f.staff)).status, 403);
      assert.equal((await pay(c.appointment.id, c.payment, "scope-foreign-route", {}, f.foreign)).status, 403);
      assert.equal((await pay(randomUUID(), c.payment, "scope-opaque-appointment")).status, 404);
      assert.equal((await pay(c.appointment.id, c.payment, "scope-opaque-payment", { paymentId: other.payment.id })).status, 404);
      assert.equal((await pay(c.appointment.id, c.payment, "scope-body-tenant", { merchantId: f.foreign.merchant_id })).status, 403);
      assert.equal((await pay(c.appointment.id, c.payment, "scope-body-identity", { appointmentId: c.appointment.id })).status, 400);
      // JSON null may be rejected by the parser before auth/audit. Do not alter
      // the existing fixture's entered-handler audit assertion to test this path.
      const raw = await fetch(f.runtime.apiOrigin + path(c.appointment.id), { method: "POST", redirect: "error", signal: AbortSignal.timeout(15_000),
        headers: { "content-type": "application/json", authorization: "Bearer " + f.owner.access_token }, body: "null" });
      assert.equal(raw.status, 400); await raw.arrayBuffer(); assert.deepEqual(await snapshot(c.appointment.id), before);
      assert.equal((await snapshot(other.appointment.id)).receipts.length, 0);
    });
    await t.test("concurrent identical requests have one receipt/payment increment/audit/outbox", async () => {
      const c = await seed("same-key"), before = await snapshot(c.appointment.id);
      const results = await Promise.all([pay(c.appointment.id, c.payment, "concurrent-same"), pay(c.appointment.id, c.payment, "concurrent-same")]);
      assert.ok(results.every(r => r.status === 201), JSON.stringify(results)); assert.equal(results.filter(r => r.body.replayed).length, 1);
      assert.equal(results[0].body.receipt.id, results[1].body.receipt.id);
      const after = await snapshot(c.appointment.id); assert.equal(after.receipts.length, 1); assert.equal(after.balances[0].version, 2);
      assert.equal(after.audits.length, before.audits.length + 1); assert.equal(after.events.length, before.events.length + 1);
      assert.deepEqual(after.appointment, before.appointment);
    });
    await t.test("different keys competing for the full remaining amount cannot settle twice", async () => {
      const c = await seed("different-keys"); const results = await Promise.all([pay(c.appointment.id, c.payment, "compete-left"), pay(c.appointment.id, c.payment, "compete-right")]);
      assert.deepEqual(results.map(r => r.status).sort(), [201, 409]);
      const after = await snapshot(c.appointment.id); assert.equal(after.receipts.length, 1); assert.equal(after.receipts[0].amountCents, 5000);
      assert.equal(after.balances[0].version, 2); assert.equal(after.audits.length, 1); assert.equal(after.events.length, 1);
    });
    await t.test("real receipt/audit/outbox SQL failure rolls back all financial facts and clean retry records once", async () => {
      for (const stage of ["receipt", "audit", "outbox"]) {
        const c = await seed("rollback-" + stage), before = await snapshot(c.appointment.id);
        const table = stage === "receipt" ? "attendance_receipts" : stage === "audit" ? "appointment_audits" : "outbox_messages";
        const condition = stage === "receipt" ? "TRUE" : stage === "audit" ? "NEW.action='attendance_receipt'" : "NEW.event_type='service.payment.recorded_at_attendance'";
        await f.runtime.db.sql("CREATE FUNCTION t37_fail_write() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF " + condition + " THEN RAISE EXCEPTION 'synthetic_t37_failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER t37_fail_write BEFORE INSERT ON " + table + " FOR EACH ROW EXECUTE FUNCTION t37_fail_write();");
        try { const result = await pay(c.appointment.id, c.payment, "rollback-" + stage); assert.equal(result.status, 500); assert.deepEqual(await snapshot(c.appointment.id), before); }
        finally { await f.runtime.db.sql("DROP TRIGGER t37_fail_write ON " + table + "; DROP FUNCTION t37_fail_write();"); }
        const retry = await pay(c.appointment.id, c.payment, "rollback-" + stage); assert.equal(retry.status, 201, JSON.stringify(retry));
        const after = await snapshot(c.appointment.id); assert.equal(after.receipts.length, 1); assert.equal(after.balances[0].version, 2);
        assert.equal(after.audits.length, 1); assert.equal(after.events.length, 1); assert.deepEqual(after.appointment, before.appointment);
      }
    });
    await t.test("an imported historical local receipt is preserved and only its complete remaining balance can settle", async () => {
      const c = await seed("historic");
      const history = await f.prisma.attendanceReceipt.create({ data: { merchantId: original.merchantId, appointmentPaymentId: c.payment.id,
        amountCents: 1500, currency: "BRL", paymentMethod: "Historical local", operatorId: f.owner.user_id, receivedAt: new Date("2020-01-01Z"),
        idempotencyKey: "historical-import", requestFingerprint: "historical-import" } });
      const before = await snapshot(c.appointment.id); assert.equal((await pay(c.appointment.id, c.payment, "historic-partial", { amountCents: 3000 })).status, 409);
      assert.deepEqual(await snapshot(c.appointment.id), before);
      const result = await pay(c.appointment.id, c.payment, "historic-integral", { amountCents: 3500 }); assert.equal(result.status, 201, JSON.stringify(result));
      const after = await snapshot(c.appointment.id); assert.equal(after.receipts.reduce((sum, x) => sum + x.amountCents, 0), 5000);
      assert.deepEqual(after.receipts.find(x => x.id === history.id), history); assert.equal(after.balances[0].status, "approved");
    });
    await t.test("online linkage and inconsistent historical currency cannot be presented as a valid local settlement", async () => {
      const online = await seed("online-negative"); await f.prisma.appointmentPayment.update({ where: { id: online.payment.id },
        data: { mode: "online", provider: "asaas", providerPaymentId: "synthetic-private-provider" } });
      const before = await snapshot(online.appointment.id); assert.equal((await pay(online.appointment.id, online.payment, "online-denied")).status, 409);
      assert.deepEqual(await snapshot(online.appointment.id), before);
      const invalid = await seed("invalid-history"); await f.prisma.attendanceReceipt.create({ data: { merchantId: original.merchantId,
        appointmentPaymentId: invalid.payment.id, amountCents: 100, currency: "USD", paymentMethod: "Historical", operatorId: f.owner.user_id,
        idempotencyKey: "invalid-currency-import", requestFingerprint: "invalid-currency-import" } });
      const stable = await snapshot(invalid.appointment.id); assert.equal((await pay(invalid.appointment.id, invalid.payment, "invalid-history-denied")).status, 409);
      assert.deepEqual(await snapshot(invalid.appointment.id), stable);
    });
    await t.test("disabling new admissions and choosing online for new bookings does not rewrite an existing local obligation", async () => {
      const c = await seed("policy-changed"), current = await f.prisma.serviceBusinessPolicy.findUniqueOrThrow({ where: { merchantId: original.merchantId } });
      const changed = await f.request("/merchants/me/service-business-policy", { expectedVersion: current.version,
        admissionsEnabled: false, holdEnabled: false, paymentMode: "online" }, f.owner, "PUT"); assert.equal(changed.status, 200);
      const before = await snapshot(c.appointment.id), result = await pay(c.appointment.id, c.payment, "receipt-historical-policy");
      assert.equal(result.status, 201, JSON.stringify(result)); assert.equal(result.body.payment.mode, "at_attendance");
      assert.deepEqual((await snapshot(c.appointment.id)).appointment, before.appointment);
    });
    await t.test("admin may record a local receipt while product/Staff authority remains denied and no provider/stock effects exist", async () => {
      const c = await seed("admin"); await f.prisma.merchantUser.update({ where: { id: f.owner.user_id }, data: { role: "admin" } });
      await f.prisma.merchantTeamMember.updateMany({ where: { userId: f.owner.user_id }, data: { role: "ADMIN" } });
      const login = await fetch(f.runtime.apiOrigin + "/auth/login", { method: "POST", redirect: "error", signal: AbortSignal.timeout(15_000),
        headers: { "content-type": "application/json" }, body: JSON.stringify({ email: f.owner.email, password: f.owner.password }) });
      assert.equal(login.status, 201); const admin = { ...f.owner, ...await login.json() };
      const result = await pay(c.appointment.id, c.payment, "admin-receipt", {}, admin);
      assert.equal(result.status, 201, JSON.stringify(result)); assert.equal(result.body.receipt.operatorId, admin.user_id);
      const products = await f.request(f.prefix(f.products) + "/" + c.appointment.id + "/attendance-receipts", body(c.payment, "product-denied"), f.products);
      assert.equal(products.status, 403);
      assert.equal(await f.prisma.paymentIntent.count(), 0); assert.equal(await f.prisma.inventoryMovement.count(), 0);
      assert.equal(await f.prisma.completedOrder.count(), 0); assert.equal(f.runtime.evidence().providerCalls, 0);
    });
  } finally { await f.close(); }
});
