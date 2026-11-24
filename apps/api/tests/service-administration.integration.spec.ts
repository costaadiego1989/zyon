import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { createServiceOperationsHttpFixture } from "./service-operations-http.fixture.js";
import { SERVICE_LOCAL_TEST_MS } from "./service-test-startup.mjs";
import { ReadServiceAppointments } from "../src/modules/operations/application/read-service-appointments.js";
import { noAppointmentLease } from "../src/shared/bookings/appointment-lease-proof.js";

test("T41 HTTP and SQL reads", { timeout: SERVICE_LOCAL_TEST_MS }, async t => {
  const f = await createServiceOperationsHttpFixture({ serviceReleaseFixture: "matching" });
  try {
    const c = await f.prepare("reader"), { prisma } = f;
    const source = await prisma.serviceAppointment.findUniqueOrThrow({ where: { id: c.appointment.id } });
    const category = await prisma.productCategory.create({ data: { merchantId: c.merchantId, name: "Reader category", slug: "reader-category" } });
    await prisma.product.update({ where: { id: c.product.id }, data: { categoryId: category.id } });
    const states = ["pending", "scheduled", "in_service", "completed", "no_show", "cancelled"] as const;
    let seedSerial = 0;
    const seed = async (suffix: string, operationalStatus: typeof states[number], explicitStart?: Date) => {
      const startsAt = explicitStart ?? new Date(Date.parse(c.date + "T13:00:00Z") + seedSerial++ * 30 * 60_000);
      return prisma.serviceAppointment.create({ data: { ...source, id: randomUUID(), operationalStatus, startsAt, timeZone: "UTC",
        endsAt: new Date(startsAt.getTime() + source.durationMinutes * 60_000), orderId: null, orderUnitId: null,
        availabilityExceptionId: null, idempotencyKey: "reader:" + suffix, requestFingerprint: "synthetic-reader:" + suffix,
        customerSnapshot: { name: "Reader buyer", phone: "+5521999990000", ignored: "private-customer" } } });
    };
    const appointments: Array<typeof source> = [];
    for (const status of states) appointments.push(await seed(status, status));
    const root = f.prefix(), period = { fromDate: c.date, toDate: c.date };
    const url = (values: Record<string, string> = {}) => root + "?" + new URLSearchParams({ ...period, ...values });
    const get = (path: string, auth: any = f.owner) => f.request(path, undefined, auth, "GET");
    const snapshot = async () => ({
      appointments: await prisma.serviceAppointment.findMany({ where: { merchantId: c.merchantId }, orderBy: { id: "asc" } }),
      payments: await prisma.appointmentPayment.findMany({ where: { merchantId: c.merchantId }, orderBy: { id: "asc" } }),
      audits: await prisma.appointmentAudit.findMany({ where: { merchantId: c.merchantId }, orderBy: { id: "asc" } }),
      events: await prisma.outboxMessage.findMany({ where: { merchantId: c.merchantId, producer: "service-booking" },
        select: { eventId: true, eventType: true, merchantId: true, payload: true, causationId: true }, orderBy: { eventId: "asc" } }),
      orders: await prisma.completedOrder.count({ where: { merchantId: c.merchantId } }),
      inventory: await prisma.inventoryMovement.count({ where: { merchantId: c.merchantId } }),
    });
    await t.test("actual owner HTTP lists complete six-state totals without confusing page size with catalogue size", async () => {
      const before = await snapshot(), result = await get(url({ limit: "2" }));
      assert.equal(result.status, 200, JSON.stringify(result)); assert.equal(result.body.items.length, 2); assert.equal(result.body.totalCount, 7);
      assert.deepEqual(result.body.countsByStatus, { pending: 1, scheduled: 2, in_service: 1, completed: 1, no_show: 1, cancelled: 1 });
      assert.ok(result.body.nextCursor); assert.equal(result.body.timeZone, "America/Sao_Paulo"); assert.ok(Number.isFinite(Date.parse(result.body.asOf)));
      assert.deepEqual(await snapshot(), before);
    });
    await t.test("stable cursor pages enumerate all canonical IDs once and preserve full filtered totals", async () => {
      const found: string[] = []; let cursor: string | undefined;
      do {
        const result = await get(url({ limit: "2", ...(cursor ? { cursor } : {}) })); assert.equal(result.status, 200, JSON.stringify(result));
        assert.equal(result.body.totalCount, 7); found.push(...result.body.items.map((value: any) => value.id)); cursor = result.body.nextCursor ?? undefined;
        assert.ok(found.length <= 7, "bounded source pagination must terminate without repeated IDs");
      } while (cursor);
      assert.equal(new Set(found).size, 7); assert.deepEqual(found.sort(), [source.id, ...appointments.map(value => value.id)].sort());
    });
    await t.test("professional, category, product, period and status filter the same counts and page", async () => {
      const result = await get(url({ professionalId: c.professional.id, categoryId: category.id, productId: c.product.id, status: "completed" }));
      assert.equal(result.status, 200, JSON.stringify(result)); assert.equal(result.body.totalCount, 1);
      assert.deepEqual(result.body.items.map((value: any) => value.id), [appointments.find(value => value.operationalStatus === "completed")!.id]);
      assert.equal(result.body.countsByStatus.completed, 1); assert.equal(Object.values(result.body.countsByStatus).reduce((sum: number, count: any) => sum + count, 0), 1);
    });
    await t.test("real path, role, mode and unauthenticated denials do not expose another company", async () => {
      assert.equal((await get(url(), null)).status, 401); assert.equal((await get(url(), f.foreign)).status, 403);
      assert.equal((await get(f.prefix(f.staff) + "?" + new URLSearchParams(period), f.staff)).status, 403);
      assert.equal((await get(f.prefix(f.products) + "?" + new URLSearchParams(period), f.products)).status, 403);
      const foreign = await get(f.prefix(f.foreign) + "/" + source.id, f.foreign); assert.equal(foreign.status, 404);
      assert.equal(JSON.stringify(foreign.body).includes(source.id), false);
    });
    await t.test("detail preserves stored zone, source state and payment facts while excluding private metadata", async () => {
      const pending = appointments.find(value => value.operationalStatus === "pending")!;
      await prisma.appointmentPayment.create({ data: { merchantId: c.merchantId, appointmentId: pending.id, mode: "online", status: "approved",
        amountCents: 5000, currency: "BRL", idempotencyKey: "reader-paid-pending", requestFingerprint: "private-fingerprint",
        providerEvidence: { secret: "private-provider" }, providerPaymentId: "private-provider-id" } });
      await prisma.appointmentAudit.create({ data: { merchantId: c.merchantId, appointmentId: pending.id, commandId: "reader-history", action: "synthetic_original",
        version: pending.version, origin: "manual", before: { privatePaymentContinuation: "private-continuation" }, after: { privateLease: noAppointmentLease({ resourceId: "professional:" + pending.professionalId, slotId: "private-generation",
          startsAt: pending.startsAt.toISOString(), endsAt: pending.endsAt.toISOString() }, "pending_without_lease") } } });
      const before = await snapshot(), result = await get(root + "/" + pending.id); assert.equal(result.status, 200, JSON.stringify(result));
      assert.equal(result.body.id, pending.id); assert.equal(result.body.merchantId, c.merchantId); assert.equal(result.body.professionalId, pending.professionalId);
      assert.equal(result.body.productId, pending.productId); assert.equal(result.body.variantId, pending.variantId);
      assert.equal(result.body.startsAt, pending.startsAt.toISOString()); assert.equal(result.body.endsAt, pending.endsAt.toISOString());
      assert.equal(result.body.timeZone, "UTC"); assert.equal(result.body.priceInCents, 5000); assert.equal(result.body.operationalStatus, "pending");
      assert.equal(result.body.payments[0].status, "approved"); assert.equal(Object.hasOwn(result.body, "attended"), false);
      assert.equal(JSON.stringify(result.body).includes("private-"), false); assert.equal(result.body.history[0].action, "synthetic_original");
      assert.deepEqual(await snapshot(), before);
    });
    await t.test("strict HTTP filters refuse arrays, foreign selectors, authority overrides and malformed cursors", async () => {
      const before = await snapshot();
      const foreignQuery = await get(url({ merchantId: f.foreign.merchant_id }));
      assert.equal(foreignQuery.status, 403); assert.equal(foreignQuery.body.code, "tenant_mismatch_query");
      for (const values of [{ limit: "101" }, { status: "paid" }, { cursor: "not-valid-cursor" }, { fromDate: "2030-02-30" }])
        assert.equal((await get(url(values))).status, 400);
      assert.equal((await get(url() + "&status=pending&status=completed")).status, 400);
      const page = await get(url({ limit: "2" })); assert.equal(page.status, 200);
      assert.equal((await get(url({ limit: "2", status: "pending", cursor: page.body.nextCursor }))).status, 400);
      assert.deepEqual(await snapshot(), before);
    });
    await t.test("Brasilia day boundaries include exact lower instant and exclude next-day lower instant", async () => {
      const low = await seed("lower", "scheduled", new Date(c.date + "T03:00:00Z"));
      const beforeDay = await seed("before", "scheduled", new Date(c.date + "T02:30:00Z"));
      const next = new Date(c.date + "T00:00:00Z"); next.setUTCDate(next.getUTCDate() + 1);
      const upper = await seed("upper", "scheduled", new Date(next.toISOString().slice(0, 10) + "T03:00:00Z"));
      const result = await get(url()); assert.equal(result.status, 200);
      const ids = result.body.items.map((value: any) => value.id); assert.equal(ids.includes(low.id), true);
      assert.equal(ids.includes(beforeDay.id), false); assert.equal(ids.includes(upper.id), false);
    });
    await t.test("reader count and rows stay in one actual SQL snapshot when another connection commits after count", async () => {
      const actor = { merchantId: c.merchantId, userId: f.owner.user_id, role: "owner" };
      let insertedId = "";
      // Transparent scheduling barrier around the real count delegate only. SQL,
      // authorization and projections remain canonical. This is a direct reader
      // proof, not a second HTTP/route proof or an alternate persistence result.
      const realTransaction = prisma.$transaction.bind(prisma);
      const observed = { $transaction: (work: any, options: any) => realTransaction(async (tx: any) => {
        const count = tx.serviceAppointment.count.bind(tx.serviceAppointment);
        const delegate = new Proxy(tx.serviceAppointment, { get(target, key) {
          if (key === "count") return async (input: any) => { const total = await count(input); insertedId = (await seed("snapshot", "scheduled")).id; return total; };
          const value = Reflect.get(target, key); return typeof value === "function" ? value.bind(target) : value;
        } });
        return work(new Proxy(tx, { get(target, key) { return key === "serviceAppointment" ? delegate : Reflect.get(target, key); } }));
      }, options) };
      const before = await prisma.serviceAppointment.count({ where: { merchantId: c.merchantId, startsAt: { gte: new Date(c.date + "T03:00Z"), lt: new Date(new Date(c.date + "T03:00Z").getTime() + 86_400_000) } } });
      const result = await new ReadServiceAppointments(observed as never).list(actor, { ...period, limit: "100" });
      assert.ok(insertedId); assert.equal(result.totalCount, before); assert.equal(result.items.length, before);
      assert.equal(result.items.some(value => value.id === insertedId), false); assert.equal(Object.values(result.countsByStatus).reduce((sum, count) => sum + count, 0), before);
      assert.equal(await prisma.serviceAppointment.count({ where: { id: insertedId } }), 1);
    });
    await t.test("an actual admin session can read without changing the existing mutation controller", async () => {
      await prisma.merchantUser.update({ where: { id: f.owner.user_id }, data: { role: "admin" } });
      await prisma.merchantTeamMember.updateMany({ where: { userId: f.owner.user_id }, data: { role: "ADMIN" } });
      const login = await f.request("/auth/login", { email: f.owner.email, password: f.owner.password }, null); assert.equal(login.status, 201);
      const result = await get(root + "/" + source.id, { ...f.owner, ...login.body }); assert.equal(result.status, 200, JSON.stringify(result));
      assert.equal(result.body.id, source.id); assert.equal(result.body.version, source.version);
    });
    assert.equal(f.runtime.evidence().providerCalls, 0);
  } finally { await f.close(); }
});
