import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { createServiceOperationsHttpFixture } from "./service-operations-http.fixture.js";
import { SERVICE_LOCAL_TEST_MS } from "./service-test-startup.mjs";

// ATEND-07, BOOK-07/09: actual authenticated AppModule/HTTP/SQL. An imported
// historical receipt is a read precondition, never permission for a new partial.
test("T80 operation summary HTTP and SQL", { timeout: SERVICE_LOCAL_TEST_MS }, async t => {
  const f = await createServiceOperationsHttpFixture({ serviceReleaseFixture: "matching" });
  try {
    assert.equal(f.runtime.evidence().canonicalAppModule, true);
    assert.equal(f.runtime.evidence().authOverrides, false);
    assert.equal(f.runtime.evidence().repositoryOverrides, false);
    const merchantId = f.owner.merchant_id;
    const priorPolicy = await f.prisma.serviceBusinessPolicy.findUnique({ where: { merchantId } });
    const policy = await f.request("/merchants/me/service-business-policy", {
      expectedVersion: priorPolicy?.version ?? 0, paymentMode: "at_attendance", holdEnabled: false, admissionsEnabled: true,
    }, f.owner, "PUT");
    assert.equal(policy.status, 200, JSON.stringify(policy));
    const product = await f.prisma.product.create({ data: { merchantId, name: "Summary local service", type: "service", isActive: true,
      metadata: { serviceSchedule: { timeZone: "America/Sao_Paulo", durationMinutes: 20, slots: [] } },
      variants: { create: { sku: "operation-summary", isActive: true, price: { create: { basePriceInCents: 5000, currency: "BRL" } } } },
    }, include: { variants: true } });
    const created = await f.request(f.path(f.owner), { ...f.profile, productIds: [product.id] }, f.owner);
    assert.equal(created.status, 201, JSON.stringify(created));
    const professional = await f.request(f.path(f.owner) + "/" + created.body.id + "/availability", {
      expectedVersion: created.body.version, timeZone: "America/Sao_Paulo",
      rows: Array.from({ length: 7 }, (_, weekday) => ({ weekday, startMinute: 600, endMinute: 720 })),
    }, f.owner, "PUT");
    assert.equal(professional.status, 200, JSON.stringify(professional));
    const date = new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10);
    const made = await f.request(f.prefix() + "/manual", { commandId: randomUUID(), productId: product.id,
      variantId: product.variants[0].id, professionalId: created.body.id, expectedProfessionalVersion: professional.body.version,
      expectedPolicyVersion: policy.body.version, startsAt: date + "T13:00:00.000Z",
      customer: { kind: "contact", name: "Summary synthetic contact", email: "summary@example.test" },
    });
    assert.equal(made.status, 201, JSON.stringify(made));
    const appointmentId = made.body.appointment.id;
    const payment = await f.prisma.appointmentPayment.findFirstOrThrow({ where: { merchantId, appointmentId, mode: "at_attendance" } });
    const imported = await f.prisma.attendanceReceipt.create({ data: { merchantId, appointmentPaymentId: payment.id,
      amountCents: 1500, currency: "BRL", paymentMethod: "Imported historical receipt", operatorId: f.owner.user_id,
      receivedAt: new Date("2020-01-01T12:00:00Z"), idempotencyKey: "summary-imported-history", requestFingerprint: "synthetic-imported-history" } });
    const path = f.prefix() + "/" + appointmentId;
    const get = async (url = path + "/operation-summary", auth: typeof f.owner | null = f.owner) => {
      const response = await fetch(f.runtime.apiOrigin + url, { redirect: "error", signal: AbortSignal.timeout(15_000),
        headers: auth ? { authorization: "Bearer " + auth.access_token } : {} });
      return { status: response.status, headers: response.headers, body: await response.json() };
    };
    const snapshot = async () => ({ ...await f.snapshot(appointmentId),
      receipts: await f.prisma.attendanceReceipt.findMany({ where: { merchantId, appointmentPaymentId: payment.id }, orderBy: { id: "asc" } }),
      inventory: await f.prisma.inventoryMovement.findMany({ where: { merchantId }, orderBy: { id: "asc" } }),
    });
    const receipt = (amountCents: number, expectedPaymentVersion = payment.version) => f.request(path + "/attendance-receipts", {
      commandId: randomUUID(), paymentId: payment.id, expectedPaymentVersion, amountCents, currency: "BRL", paymentMethod: "Pix presencial",
    });

    await t.test("owner reads current version, exact imported balance and independent allowed actions without writes", async () => {
      const before = await snapshot(), started = Date.now(), result = await get();
      assert.equal(result.status, 200, JSON.stringify(result.body));
      assert.equal(result.headers.get("cache-control"), "no-store");
      assert.ok(Date.parse(result.body.asOf) >= started - 1000 && Date.parse(result.body.asOf) <= Date.now());
      const { asOf, ...facts } = result.body;
      assert.equal(typeof asOf, "string");
      assert.deepEqual(facts, { merchantId, appointmentId, appointmentVersion: 1,
        attendanceActions: ["start_service", "no_show"], canReviewCancellation: true, canReviewRescheduling: true,
        localPayments: [{ paymentId: payment.id, paymentVersion: payment.version, currency: "BRL", balanceStatus: "available",
          receivedCents: 1500, remainingCents: 3500, canRecordReceipt: true }] });
      assert.equal(JSON.stringify(result.body).includes("requestFingerprint"), false);
      assert.equal(JSON.stringify(result.body).includes("providerEvidence"), false);
      assert.deepEqual(await snapshot(), before);
    });

    await t.test("review never grants partial or excessive receipts and preserves historical facts after each rejection", async () => {
      const before = await snapshot();
      for (const amount of [3000, 3501]) {
        const rejected = await receipt(amount);
        assert.equal(rejected.status, 409, JSON.stringify(rejected));
        assert.deepEqual(await snapshot(), before);
      }
      assert.deepEqual((await get()).body.localPayments, [{ paymentId: payment.id, paymentVersion: payment.version, currency: "BRL",
        balanceStatus: "available", receivedCents: 1500, remainingCents: 3500, canRecordReceipt: true }]);
      assert.deepEqual(await snapshot(), before);
    });

    await t.test("actual attendance changes only operation and the next read exposes its canonical version", async () => {
      const before = await snapshot(), moved = await f.request(path + "/transitions", {
        commandId: randomUUID(), expectedVersion: 1, action: "start_service",
      });
      assert.equal(moved.status, 201, JSON.stringify(moved));
      const after = await snapshot();
      assert.equal(after.appointment.operationalStatus, "in_service");
      assert.equal(after.appointment.version, 2);
      assert.deepEqual(after.balances, before.balances);
      assert.deepEqual(after.receipts, before.receipts);
      assert.deepEqual(after.inventory, before.inventory);
      const current = await get();
      assert.equal(current.status, 200);
      assert.equal(current.body.appointmentVersion, 2);
      assert.deepEqual(current.body.attendanceActions, ["complete_service"]);
      assert.equal(current.body.canReviewCancellation, true);
      assert.equal(current.body.canReviewRescheduling, false);
      assert.equal(current.body.localPayments[0].remainingCents, 3500);
      assert.deepEqual(await snapshot(), after);
    });

    await t.test("only the full remaining balance settles via the real writer without completing attendance", async () => {
      const before = await snapshot(), paid = await receipt(3500);
      assert.equal(paid.status, 201, JSON.stringify(paid));
      const after = await snapshot();
      assert.deepEqual(after.appointment, before.appointment);
      assert.deepEqual(after.inventory, before.inventory);
      assert.deepEqual(after.receipts.find(row => row.id === imported.id), imported);
      assert.equal(after.receipts.reduce((sum, row) => sum + row.amountCents, 0), 5000);
      assert.equal(after.balances[0].status, "approved");
      assert.equal(after.balances[0].version, payment.version + 1);
      assert.equal(after.balances[0].paymentIntentId, null);
      assert.equal(after.balances[0].provider, null);
      const reviewed = await get();
      assert.equal(reviewed.status, 200);
      assert.equal(reviewed.body.appointmentVersion, 2);
      assert.deepEqual(reviewed.body.attendanceActions, ["complete_service"]);
      assert.deepEqual(reviewed.body.localPayments, [{ paymentId: payment.id, paymentVersion: payment.version + 1, currency: "BRL",
        balanceStatus: "not_payable", receivedCents: 5000, remainingCents: 0, canRecordReceipt: false }]);
      assert.deepEqual(await snapshot(), after);
    });

    await t.test("auth, role, mode, foreign and stale requests cannot use a review as write authority", async () => {
      const before = await snapshot();
      assert.equal((await get(path + "/operation-summary", null)).status, 401);
      assert.equal((await get(path + "/operation-summary", f.foreign)).status, 403);
      assert.equal((await get(f.prefix(f.staff) + "/" + appointmentId + "/operation-summary", f.staff)).status, 403);
      assert.equal((await get(f.prefix(f.products) + "/" + appointmentId + "/operation-summary", f.products)).status, 403);
      const foreign = await get(f.prefix(f.foreign) + "/" + appointmentId + "/operation-summary", f.foreign);
      assert.equal(foreign.status, 404);
      assert.equal(JSON.stringify(foreign.body).includes(appointmentId), false);
      const stale = await f.request(path + "/transitions", { commandId: randomUUID(), expectedVersion: 1, action: "complete_service" });
      assert.equal(stale.status, 409);
      assert.deepEqual(await snapshot(), before);
      const fresh = await get();
      assert.equal(fresh.body.appointmentVersion, 2);
      assert.deepEqual(fresh.body.attendanceActions, ["complete_service"]);
      assert.deepEqual(await snapshot(), before);
    });
    assert.equal(f.runtime.evidence().providerCalls, 0);
  } finally { await f.close(); }
});
