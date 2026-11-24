import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { createProfessionalHttpFixture } from "./service-professional-http-fixture.mjs";
import { SERVICE_LOCAL_TEST_MS } from "./service-test-startup.mjs";

const BR = "America/Sao_Paulo";
test("T111 actual fixed-zone HTTP and historical persistence", { timeout: SERVICE_LOCAL_TEST_MS }, async t => {
  const f = await createProfessionalHttpFixture();
  try {
    const { timeZone: _oldZone, ...omittedProfile } = f.profile;
    const product = await f.prisma.product.create({ data: { merchantId: f.owner.merchant_id, name: "Synthetic fixed-zone service", type: "service", isActive: true,
      metadata: { serviceSchedule: { timeZone: BR, durationMinutes: 30, slots: [] } }, variants: { create: { sku: "fixed-zone-service", price: { create: { basePriceInCents: 5000, currency: "BRL" } } } } }, include: { variants: true } });
    const profile = { ...omittedProfile, productIds: [product.id] };
    const grid = { rows: [{ weekday: 3, startMinute: 600, endMinute: 660 }] };
    const interval = (kind: "one_off" | "block", hour: number) => ({ kind, startsAt: `2030-01-03T${hour}:00:00.000Z`, endsAt: `2030-01-03T${hour}:30:00.000Z` });
    const state = async () => ({ professionals: await f.prisma.serviceProfessional.findMany({ orderBy: { id: "asc" } }),
      rows: await f.prisma.professionalAvailability.findMany({ orderBy: { id: "asc" } }), exceptions: await f.prisma.availabilityException.findMany({ orderBy: { id: "asc" } }),
      appointments: await f.prisma.serviceAppointment.findMany({ orderBy: { id: "asc" } }), payments: await f.prisma.appointmentPayment.findMany({ orderBy: { id: "asc" } }),
      receipts: await f.prisma.attendanceReceipt.findMany({ orderBy: { id: "asc" } }), variants: await f.prisma.productVariant.findMany({ orderBy: { id: "asc" } }) });
    let professional!: { id: string; version: number };
    await t.test("owner creates omitted and explicit Brasilia professionals", async () => {
      const made = await f.request(f.path(f.owner), profile, f.owner); assert.equal(made.status, 201, JSON.stringify(made));
      assert.equal(made.body.timeZone, BR); professional = made.body;
      const explicit = await f.request(f.path(f.owner), { ...profile, timeZone: BR }, f.owner); assert.equal(explicit.status, 201); assert.equal(explicit.body.timeZone, BR);
    });
    const base = () => f.path(f.owner) + "/" + professional.id;
    await t.test("new unsupported professional zones and caller history flags cannot write", async () => {
      for (const extra of [{ timeZone: "UTC" }, { timeZone: "America/Manaus" }, { timeZone: "UTC", legacy: true }, { timeZone: BR, createdAt: "2000-01-01T00:00:00Z" }]) {
        const before = await state(), result = await f.request(f.path(f.owner), { ...profile, ...extra }, f.owner);
        assert.equal(result.status, 400, JSON.stringify(result)); assert.deepEqual(await state(), before);
      }
    });
    await t.test("valid Staff, foreign tenant and product-mode denials remain authoritative", async () => {
      const before = await state();
      for (const auth of [f.staff, f.foreign]) assert.equal((await f.request(f.path(f.owner), { ...profile, timeZone: "UTC" }, auth)).status, 403);
      assert.equal((await f.request(f.path(f.products), { ...omittedProfile, timeZone: BR }, f.products)).status, 403);
      assert.deepEqual(await state(), before);
    });
    await t.test("omitted and explicit Brasilia recurring writes preserve exact wall minutes and UTC slots", async () => {
      for (const extra of [{}, { timeZone: BR }]) {
        const result = await f.request(base() + "/availability", { ...grid, ...extra, expectedVersion: professional.version }, f.owner, "PUT");
        assert.equal(result.status, 200, JSON.stringify(result)); professional.version = result.body.version;
        assert.equal(result.body.timeZone, BR); assert.equal(result.body.rows[0].timeZone, BR); assert.equal(result.body.rows[0].startMinute, 600);
      }
      const query = new URLSearchParams({ productId: product.id, variantId: product.variants[0].id, professionalId: professional.id, date: "2030-01-02" });
      const slots = await f.request(`/merchants/${f.owner.merchant_id}/service-availability/slots?${query}`, undefined, f.owner, "GET");
      assert.equal(slots.status, 200, JSON.stringify(slots)); assert.equal(slots.body.slots[0].startsAt, "2030-01-02T13:00:00.000Z"); assert.equal(slots.body.slots[0].startTime, "10:00");
    });
    await t.test("unsupported grade and interval zones reject after the existing CAS and auth guards", async () => {
      for (const zone of ["UTC", "America/Manaus"]) {
        const before = await state();
        assert.equal((await f.request(base() + "/availability", { ...grid, timeZone: zone, expectedVersion: professional.version }, f.owner, "PUT")).status, 400);
        assert.equal((await f.request(base() + "/availability-exceptions", { ...interval("one_off", 13), timeZone: zone, expectedVersion: professional.version }, f.owner)).status, 400);
        assert.equal((await f.request(base() + "/availability-exceptions", { ...interval("block", 13), timeZone: zone, isActive: false, expectedVersion: professional.version }, f.owner)).status, 400);
        assert.equal((await f.request(base() + "/availability", { ...grid, timeZone: zone, expectedVersion: professional.version - 1 }, f.owner, "PUT")).status, 409);
        assert.equal((await f.request(base() + "/availability", { ...grid, timeZone: zone, expectedVersion: professional.version }, f.staff, "PUT")).status, 403);
        assert.equal((await f.request(base() + "/availability", { ...grid, timeZone: zone, expectedVersion: professional.version }, f.foreign, "PUT")).status, 403);
        assert.equal((await f.request(f.path(f.foreign) + "/" + professional.id + "/availability", { ...grid, timeZone: zone, expectedVersion: professional.version }, f.foreign, "PUT")).status, 404);
        assert.deepEqual(await state(), before);
      }
    });
    await t.test("new one-off and block default to Brasilia without converting supplied absolute instants", async () => {
      let hour = 14;
      for (const kind of ["one_off", "block"] as const) for (const extra of [{}, { timeZone: BR }]) {
        const input = interval(kind, hour++), result = await f.request(base() + "/availability-exceptions", { ...input, ...extra, expectedVersion: professional.version }, f.owner);
        assert.equal(result.status, 201, JSON.stringify(result)); professional.version = result.body.version;
        assert.equal(result.body.exception.timeZone, BR); assert.equal(result.body.exception.startsAt, input.startsAt); assert.equal(result.body.exception.endsAt, input.endsAt);
      }
    });
    for (const oldZone of ["UTC", "America/Manaus"]) await t.test(`stored ${oldZone} history supports standalone Brasilia intervals and explicit new grade without retiming`, async () => {
      // Explicit persisted historical fixtures, not new API writes or authority flags.
      const historical = await f.prisma.serviceProfessional.create({ data: { merchantId: f.owner.merchant_id, publicName: "Historical " + oldZone, publicProfile: {}, timeZone: oldZone, isActive: true, isPublished: true } });
      await f.prisma.professionalService.create({ data: { merchantId: historical.merchantId, professionalId: historical.id, productId: product.id } });
      const row = await f.prisma.professionalAvailability.create({ data: { merchantId: historical.merchantId, professionalId: historical.id, weekday: 3, startMinute: 600, endMinute: 660, timeZone: oldZone,
        validFrom: new Date("2029-01-01T00:00:30.123Z") } });
      const appointment = await f.prisma.serviceAppointment.create({ data: { merchantId: historical.merchantId, professionalId: historical.id, productId: product.id, variantId: product.variants[0].id,
        customerSnapshot: { name: "Historical synthetic buyer" }, startsAt: new Date("2030-01-05T13:00:00Z"), endsAt: new Date("2030-01-05T13:30:00Z"), timeZone: oldZone,
        durationMinutes: 30, priceInCents: 5000, currency: "BRL", policyVersion: 1, policySnapshot: { paymentMode: "at_attendance" }, origin: "manual", operationalStatus: "scheduled",
        idempotencyKey: randomUUID(), requestFingerprint: "synthetic-historical" } });
      const payment = await f.prisma.appointmentPayment.create({ data: { merchantId: historical.merchantId, appointmentId: appointment.id, mode: "at_attendance", amountCents: 5000, currency: "BRL",
        status: "pending", idempotencyKey: randomUUID(), requestFingerprint: "synthetic-historical-payment" } });
      const historicalBase = f.path(f.owner) + "/" + historical.id;
      const one = await f.request(historicalBase + "/availability-exceptions", { ...interval("one_off", 18), timeZone: BR, expectedVersion: historical.version }, f.owner);
      assert.equal(one.status, 201, JSON.stringify(one)); assert.equal(one.body.exception.timeZone, BR);
      const afterOne = await f.prisma.serviceProfessional.findUniqueOrThrow({ where: { id: historical.id } }); assert.equal(afterOne.timeZone, oldZone);
      assert.deepEqual(await f.prisma.professionalAvailability.findUnique({ where: { id: row.id } }), row);
      const beforeOmitted = await state();
      assert.equal((await f.request(historicalBase + "/availability", { ...grid, expectedVersion: afterOne.version }, f.owner, "PUT")).status, 400);
      assert.deepEqual(await state(), beforeOmitted);
      const newGrade = await f.request(historicalBase + "/availability", { ...grid, timeZone: BR, expectedVersion: afterOne.version }, f.owner, "PUT");
      assert.equal(newGrade.status, 200, JSON.stringify(newGrade)); assert.equal(newGrade.body.timeZone, BR);
      // Withdrawal may advance updatedAt; every stored identity/time/zone/version fact stays exact.
      const oldRow = await f.prisma.professionalAvailability.findUniqueOrThrow({ where: { id: row.id } });
      assert.deepEqual({ ...oldRow, updatedAt: row.updatedAt }, { ...row, isActive: false });
      assert.deepEqual(await f.prisma.serviceAppointment.findUnique({ where: { id: appointment.id } }), appointment);
      assert.deepEqual(await f.prisma.appointmentPayment.findUnique({ where: { id: payment.id } }), payment);
    });
    await t.test("empty grade withdrawal and exact historical exception withdrawal retain stored zones and precision", async () => {
      const historical = await f.prisma.serviceProfessional.create({ data: { merchantId: f.owner.merchant_id, publicName: "Historical withdrawal", publicProfile: {}, timeZone: "UTC", isActive: true } });
      const row = await f.prisma.professionalAvailability.create({ data: { merchantId: historical.merchantId, professionalId: historical.id, weekday: 3, startMinute: 600, endMinute: 660, timeZone: "UTC" } });
      const exception = await f.prisma.availabilityException.create({ data: { merchantId: historical.merchantId, professionalId: historical.id, kind: "block", timeZone: "America/Manaus", startsAt: new Date("2030-01-02T09:00:30.123Z"),
        endsAt: new Date("2030-01-02T09:30:30.123Z"), reason: "Historical exact note", actorId: f.owner.user_id } });
      const path = f.path(f.owner) + "/" + historical.id;
      const withdrawn = await f.request(path + "/availability", { rows: [], timeZone: "UTC", expectedVersion: historical.version }, f.owner, "PUT");
      assert.equal(withdrawn.status, 200, JSON.stringify(withdrawn)); assert.equal(withdrawn.body.timeZone, "UTC");
      const oldRow = await f.prisma.professionalAvailability.findUniqueOrThrow({ where: { id: row.id } });
      assert.deepEqual({ ...oldRow, updatedAt: row.updatedAt }, { ...row, isActive: false });
      const removed = await f.request(path + "/availability-exceptions/" + exception.id, { ...interval("one_off", 19), isActive: false, expectedVersion: withdrawn.body.version }, f.owner, "PATCH");
      assert.equal(removed.status, 200, JSON.stringify(removed)); const actual = await f.prisma.availabilityException.findUniqueOrThrow({ where: { id: exception.id } });
      assert.equal(actual.timeZone, exception.timeZone); assert.equal(actual.kind, exception.kind); assert.equal(actual.reason, exception.reason);
      assert.equal(actual.startsAt.getTime(), exception.startsAt.getTime()); assert.equal(actual.endsAt.getTime(), exception.endsAt.getTime()); assert.equal(actual.isActive, false);
      assert.equal((await f.prisma.serviceProfessional.findUniqueOrThrow({ where: { id: historical.id } })).timeZone, "UTC");
      const edited = await f.request(path, { publicName: "Historical renamed", expectedVersion: removed.body.version }, f.owner, "PATCH");
      assert.equal(edited.status, 200, JSON.stringify(edited)); assert.equal(edited.body.timeZone, "UTC");
      const deactivated = await f.request(path + "/deactivate", { expectedVersion: edited.body.version }, f.owner);
      assert.equal(deactivated.status, 201, JSON.stringify(deactivated)); assert.equal(deactivated.body.timeZone, "UTC"); assert.equal(deactivated.body.isActive, false);
    });
    await t.test("authenticated Admin uses the same omitted-zone policy", async () => {
      const admin = await f.register("services", "fixed-zone-admin");
      await f.prisma.merchantUser.update({ where: { id: admin.user_id }, data: { role: "admin" } });
      await f.prisma.merchantTeamMember.updateMany({ where: { userId: admin.user_id }, data: { role: "ADMIN" } });
      const login = await f.request("/auth/login", { email: admin.email, password: admin.password }); assert.equal(login.status, 201); Object.assign(admin, login.body);
      const made = await f.request(f.path(admin), omittedProfile, admin); assert.equal(made.status, 201, JSON.stringify(made)); assert.equal(made.body.timeZone, BR);
      const path = f.path(admin) + "/" + made.body.id;
      const saved = await f.request(path + "/availability", { ...grid, expectedVersion: made.body.version }, admin, "PUT"); assert.equal(saved.status, 200, JSON.stringify(saved));
      const one = await f.request(path + "/availability-exceptions", { ...interval("one_off", 20), expectedVersion: saved.body.version }, admin);
      assert.equal(one.status, 201, JSON.stringify(one)); assert.equal(one.body.exception.timeZone, BR);
    });
    assert.equal(f.runtime.evidence().providerCalls, 0); assert.equal(f.runtime.evidence().authOverrides, false); assert.equal(f.runtime.evidence().repositoryOverrides, false);
  } finally { await f.close(); }
});
