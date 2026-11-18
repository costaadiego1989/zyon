import assert from "node:assert/strict";
import test from "node:test";
import { createServiceOperationsHttpFixture } from "./service-operations-http.fixture.js";
import { SERVICE_LOCAL_TEST_MS } from "./service-test-startup.mjs";

test("T34 HTTP and SQL", { timeout: SERVICE_LOCAL_TEST_MS }, async t => {
  const f = await createServiceOperationsHttpFixture();
  try {
    const scopeOwner = await f.register("services", "reschedule-scope-cohort");
    const prepareScoped = async (suffix: string) => {
      const auth = scopeOwner, merchantId = auth.merchant_id;
      const current = await f.prisma.serviceBusinessPolicy.findUnique({ where: { merchantId } });
      const policy = await f.request("/merchants/me/service-business-policy", { expectedVersion: current?.version ?? 0,
        paymentMode: "at_attendance", holdEnabled: false, admissionsEnabled: true }, auth, "PUT"); assert.equal(policy.status, 200, JSON.stringify(policy));
      const product = await f.prisma.product.create({ data: { merchantId, name: "Public " + suffix, type: "service", isActive: true,
        metadata: { serviceSchedule: { timeZone: "UTC", durationMinutes: 20, slots: [] } }, variants: { create: { sku: "ops-" + suffix,
          isActive: true, price: { create: { basePriceInCents: 5000, currency: "BRL" } } } } }, include: { variants: true } });
      const created = await f.request(f.path(auth), { publicName: "Public professional " + suffix, timeZone: "UTC", isPublished: true, productIds: [product.id] }, auth);
      assert.equal(created.status, 201, JSON.stringify(created));
      const grade = await f.request(f.path(auth) + "/" + created.body.id + "/availability", { expectedVersion: created.body.version, timeZone: "UTC",
        rows: Array.from({ length: 7 }, (_, weekday) => ({ weekday, startMinute: 600, endMinute: 720 })) }, auth, "PUT"); assert.equal(grade.status, 200, JSON.stringify(grade));
      const professional = await f.prisma.serviceProfessional.findUniqueOrThrow({ where: { id: created.body.id } });
      const date = new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10);
      const command = { commandId: "manual-" + suffix, productId: product.id, variantId: product.variants[0].id, professionalId: professional.id,
        expectedProfessionalVersion: professional.version, expectedPolicyVersion: policy.body.version, startsAt: date + "T10:00:00.000Z",
        customer: { kind: "contact", name: "Synthetic operator contact", email: "operator-contact@example.test" } };
      const made = await f.request(f.prefix(auth) + "/manual", command, auth); assert.equal(made.status, 201, JSON.stringify(made));
      return { auth, merchantId, product, professional, date, command, appointment: made.body.appointment };
    };
    const preview = async (c: any, destination = { professionalId: c.professional.id, expectedProfessionalVersion: c.professional.version, startsAt: c.date + "T10:20:00.000Z" }) => {
      const response = await f.request(f.prefix(c.auth) + "/" + c.appointment.id + "/reschedule-quote", { expectedVersion: 1, destination }, c.auth);
      assert.equal(response.status, 201, JSON.stringify(response)); return { response, destination };
    };
    const input = (q: any, commandId: string) => ({ commandId, expectedVersion: 1, operatorRequestId: "operator-" + commandId,
      destination: q.destination, policyHash: q.response.body.quote.policyHash, acceptedQuoteHash: q.response.body.quoteHash });
    const apply = (c: any, body: unknown, auth = c.auth) => f.request(f.prefix(c.auth) + "/" + c.appointment.id + "/reschedule", body, auth);
    await t.test("own-appointment exclusion allows a changed duration while preserving its original history", async () => {
      const c = await f.prepare("reschedule-own"), before = await f.snapshot(c.appointment.id);
      await f.prisma.product.update({ where: { id: c.product.id }, data: { metadata: { serviceSchedule: { timeZone: "UTC", durationMinutes: 30, slots: [] } } } });
      const q = await preview(c, { professionalId: c.professional.id, expectedProfessionalVersion: c.professional.version, startsAt: c.command.startsAt });
      const result = await apply(c, input(q, "own-duration")); assert.equal(result.status, 201, JSON.stringify(result));
      const after = await f.snapshot(c.appointment.id); assert.equal(after.appointment.durationMinutes, 30); assert.equal(after.appointment.endsAt.toISOString(), c.date + "T10:30:00.000Z");
      assert.equal(after.appointment.version, 2); assert.deepEqual(after.balances, before.balances);
      assert.equal(after.appointment.requestFingerprint, before.appointment.requestFingerprint); assert.equal(after.audits.find((a: any) => a.action === "reschedule").before.durationMinutes, 20);
    });
    await t.test("the private own exclusion cannot hide a different occupied interval", async () => {
      const c = await f.prepare("reschedule-occupied");
      const other = await f.request(f.prefix() + "/manual", { ...c.command, commandId: "adjacent-other", startsAt: c.date + "T10:20:00.000Z" }); assert.equal(other.status, 201, JSON.stringify(other));
      const before = await f.snapshot(c.appointment.id), untouched = await f.snapshot(other.body.appointment.id);
      const response = await f.request(f.prefix() + "/" + c.appointment.id + "/reschedule-quote", { expectedVersion: 1,
        destination: { professionalId: c.professional.id, expectedProfessionalVersion: c.professional.version, startsAt: c.date + "T10:20:00.000Z" } });
      assert.equal(response.status, 409); assert.deepEqual(await f.snapshot(c.appointment.id), before); assert.deepEqual(await f.snapshot(other.body.appointment.id), untouched);
    });
    await t.test("opposing same-merchant moves cannot lose either occupied original", async () => {
      const left = await f.prepare("reschedule-left"), right = await f.prepare("reschedule-right");
      for (const c of [left, right]) {
        const current = await f.prisma.serviceProfessional.findUniqueOrThrow({ where: { id: c.professional.id } });
        const changed = await f.request(f.path(f.owner) + "/" + c.professional.id, { expectedVersion: current.version, productIds: [left.product.id, right.product.id] }, f.owner, "PATCH"); assert.equal(changed.status, 200, JSON.stringify(changed));
      }
      const beforeLeft = await f.snapshot(left.appointment.id), beforeRight = await f.snapshot(right.appointment.id);
      const attempts = await Promise.all([left, right].map(async (c, index) => { const target = index ? left : right;
        const current = await f.prisma.serviceProfessional.findUniqueOrThrow({ where: { id: target.professional.id } });
        return f.request(f.prefix() + "/" + c.appointment.id + "/reschedule-quote", { expectedVersion: 1,
          destination: { professionalId: target.professional.id, expectedProfessionalVersion: current.version, startsAt: c.command.startsAt } }); }));
      assert.ok(attempts.every(r => r.status === 409)); assert.deepEqual(await f.snapshot(left.appointment.id), beforeLeft); assert.deepEqual(await f.snapshot(right.appointment.id), beforeRight);
      // Real lock contention/reverse commit order still needs the dedicated held-PID native gate; these are simultaneous occupied previews.
    });
    await t.test("changed price rejects a stale quote and an explicit fresh operator acceptance adjusts only an unreceived local obligation", async () => {
      const c = await f.prepare("reschedule-price"), q = await preview(c), before = await f.snapshot(c.appointment.id);
      await f.prisma.productPrice.update({ where: { variantId: c.command.variantId }, data: { basePriceInCents: 6000 } });
      assert.equal((await apply(c, input(q, "stale-price"))).status, 409); assert.deepEqual(await f.snapshot(c.appointment.id), before);
      const fresh = await preview(c), result = await apply(c, input(fresh, "accepted-price")); assert.equal(result.status, 201, JSON.stringify(result));
      const after = await f.snapshot(c.appointment.id); assert.equal(after.appointment.priceInCents, 6000); assert.equal(after.balances[0].amountCents, 6000); assert.equal(after.balances[0].status, "pending");
      assert.equal(after.balances[0].receivedAt, null); assert.equal(await f.prisma.attendanceReceipt.count(), 0); assert.equal(await f.prisma.paymentIntent.count(), 0);
    });
    await t.test("reverse-direction commits queue behind the exact merchant holder and preserve both appointments", async () => {
      const left = await prepareScoped("reschedule-lock-left"), right = await prepareScoped("reschedule-lock-right");
      for (const c of [left, right]) {
        const current = await f.prisma.serviceProfessional.findUniqueOrThrow({ where: { id: c.professional.id } });
        const linked = await f.request(f.path(c.auth) + "/" + c.professional.id, { expectedVersion: current.version, productIds: [left.product.id, right.product.id] }, c.auth, "PATCH");
        assert.equal(linked.status, 200, JSON.stringify(linked));
      }
      const leftTarget = await f.prisma.serviceProfessional.findUniqueOrThrow({ where: { id: right.professional.id } });
      const rightTarget = await f.prisma.serviceProfessional.findUniqueOrThrow({ where: { id: left.professional.id } });
      const lq = await preview(left, { professionalId: leftTarget.id, expectedProfessionalVersion: leftTarget.version, startsAt: left.date + "T10:20:00.000Z" });
      const rq = await preview(right, { professionalId: rightTarget.id, expectedProfessionalVersion: rightTarget.version, startsAt: right.date + "T10:20:00.000Z" });
      let release!: () => void, ready!: () => void, rejectReady!: (error: unknown) => void, holderPid = 0;
      const entered = new Promise<void>((resolve, reject) => { ready = resolve; rejectReady = reject; }), barrier = new Promise<void>(resolve => { release = resolve; });
      const holder = f.prisma.$transaction(async (tx: any) => { await tx.$queryRaw`SELECT id FROM merchants WHERE id=${left.merchantId} FOR UPDATE`;
        [{ pid: holderPid }] = await tx.$queryRaw`SELECT pg_backend_pid() AS pid`; ready(); await barrier; });
      void holder.catch(rejectReady); let pending: Promise<any>[] = [];
      try {
        await entered; pending = [apply(left, input(lq, "reverse-left")), apply(right, input(rq, "reverse-right"))];
        const deadline = Date.now() + 2000; let rows: Array<{ pid: number }> = [];
        do { rows = await f.prisma.$queryRaw`WITH RECURSIVE blocked(pid) AS (
          SELECT a.pid FROM pg_stat_activity a WHERE ${holderPid}=ANY(pg_blocking_pids(a.pid))
          UNION SELECT a.pid FROM pg_stat_activity a JOIN blocked b ON b.pid=ANY(pg_blocking_pids(a.pid))
        ) SELECT DISTINCT pid FROM blocked`; if (rows.length < 2) await new Promise<void>(resolve => setImmediate(resolve)); } while (rows.length < 2 && Date.now() < deadline);
        assert.ok(rows.length >= 2); release(); await holder; const settled = await Promise.all(pending);
        assert.ok(settled.every(r => r.status === 201), JSON.stringify(settled));
        const la = (await f.snapshot(left.appointment.id)).appointment, ra = (await f.snapshot(right.appointment.id)).appointment;
        assert.equal(la.professionalId, right.professional.id); assert.equal(ra.professionalId, left.professional.id); assert.equal(la.version, 2); assert.equal(ra.version, 2);
        assert.equal(la.startsAt.toISOString(), left.date + "T10:20:00.000Z"); assert.equal(ra.startsAt.toISOString(), right.date + "T10:20:00.000Z");
      } finally { release(); await Promise.allSettled([holder, ...pending]); }
    });
    await t.test("accepted new terms do not rewrite received money or trigger a charge/refund", async () => {
      const c = await prepareScoped("reschedule-paid"), beforeBalance = (await f.snapshot(c.appointment.id)).balances[0];
      await f.prisma.appointmentPayment.update({ where: { id: beforeBalance.id }, data: { status: "approved", receivedAt: new Date(), version: { increment: 1 } } });
      await f.prisma.productPrice.update({ where: { variantId: c.command.variantId }, data: { basePriceInCents: 6000 } });
      const before = await f.snapshot(c.appointment.id), q = await preview(c); assert.equal(q.response.body.requiresSeparateFinancialReview, true);
      assert.equal((await apply(c, input(q, "paid-new-terms"))).status, 409); assert.deepEqual(await f.snapshot(c.appointment.id), before);
      assert.equal(await f.prisma.paymentIntent.count(), 0);
    });
    await t.test("foreign role, inactive destination and forged body price cannot move an appointment", async () => {
      const c = await prepareScoped("reschedule-scope"), q = await preview(c), before = await f.snapshot(c.appointment.id);
      assert.equal((await apply(c, input(q, "foreign"), f.foreign)).status, 403); assert.equal((await apply(c, { ...input(q, "body-price"), priceInCents: 1 })).status, 400);
      await f.prisma.serviceProfessional.update({ where: { id: c.professional.id }, data: { isActive: false } });
      assert.equal((await apply(c, input(q, "inactive"))).status, 404); assert.deepEqual(await f.snapshot(c.appointment.id), before);
    });
    await t.test("outbox failure restores original interval/version/balance and original availability rule", async () => {
      const c = await prepareScoped("reschedule-rollback"), q = await preview(c), before = await f.snapshot(c.appointment.id);
      await f.runtime.db.sql("CREATE FUNCTION t34_fail_event() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.event_type='service.appointment.rescheduled' THEN RAISE EXCEPTION 'synthetic_t34_event_failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER t34_fail_event BEFORE INSERT ON outbox_messages FOR EACH ROW EXECUTE FUNCTION t34_fail_event();");
      try { assert.equal((await apply(c, input(q, "rollback"))).status, 500); assert.deepEqual(await f.snapshot(c.appointment.id), before); }
      finally { await f.runtime.db.sql("DROP TRIGGER IF EXISTS t34_fail_event ON outbox_messages; DROP FUNCTION IF EXISTS t34_fail_event();"); }
    });
    assert.equal(f.runtime.evidence().providerCalls, 0);
  } finally { await f.close(); }
});
