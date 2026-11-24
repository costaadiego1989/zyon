import assert from "node:assert/strict";
import { composeOwnedSourceServiceRelease } from "./service-release-source-process.fixture.js";
import { test } from "node:test";
import { PrismaClient } from "@prisma/client";
import type { CheckoutSession } from "@zyon/shared-types";
import { createServiceTestRuntime } from "./service-test-runtime.mjs";
import { SERVICE_LOCAL_TEST_MS } from "./service-test-startup.mjs";
import { seedServiceBookingFixture } from "./service-booking-fixtures.js";
import { toCheckoutSession } from "../src/modules/checkout/domain/services/checkout-session-projection.js";
import { paymentCartFingerprint } from "../src/modules/checkout/domain/services/payment-cart-fingerprint.js";
import { confirmServiceAppointment } from "../src/modules/checkout/application/confirm-service-appointment.use-case.js";

test("T30 confirmed checkout resume", { timeout: SERVICE_LOCAL_TEST_MS }, async t => {
  const runtime = await createServiceTestRuntime({ local: true, serviceReleaseFixture: "matching" });
  let raw: PrismaClient | undefined;
  try {
  const releaseFixtureScope = composeOwnedSourceServiceRelease("matching"); t.after(() => releaseFixtureScope.close());
    raw = new PrismaClient({ datasources: { db: { url: runtime.db.prismaUrl } } });
    const prisma = raw, now = new Date(); await seedServiceBookingFixture(prisma, now);
    const date = new Date(now.getTime() + 2 * 86_400_000).toISOString().slice(0, 10);
    const cart: CheckoutSession["cart"] = { currency: "BRL", total: 50, items: [{ sku: "booking-short", product_id: "booking-short",
      variantId: "booking-short-variant", name: "Synthetic service", quantity: 1, price: 50, productType: "service", fulfillmentStrategy: "scheduled_service",
      fulfillmentSchedule: { slotId: "display-slot", date, startsAt: date + "T10:00:00.000Z", endsAt: date + "T10:20:00.000Z",
        timeZone: "UTC", durationMinutes: 20, professionalId: "booking-professional", professionalVersion: 1, policyVersion: 1 } }] };
    const start = async () => {
      const response = await fetch(runtime.apiOrigin + "/checkout/start-checkout", { method: "POST", redirect: "error", signal: AbortSignal.timeout(15_000),
        headers: { "content-type": "application/json" }, body: JSON.stringify({ merchant_id: "booking-services", session_id: "confirmed-resume", cart }) });
      return { status: response.status, body: await response.json() };
    };
    const first = await start(); assert.equal(first.status, 201, JSON.stringify(first));
    // This companion proves existing checkout HTTP resume after the actual
    // transaction command. The separate T30 HTTP companion exercises the
    // production embed confirmation capability/issuer and boundary.
    const row = await prisma.checkoutSession.update({ where: { merchantId_sessionId: {
      merchantId: "booking-services", sessionId: "confirmed-resume" } },
      data: { customer: { fullName: "Synthetic buyer", phone: "+5521999990000" } } });
    const session = toCheckoutSession(row), command = { commandId: "confirmed-resume-command", cartFingerprint: paymentCartFingerprint(session) };
    const confirmed = await prisma.$transaction(tx => confirmServiceAppointment(tx, { merchantId: row.merchantId, sessionId: row.sessionId,
      globalUserId: row.globalUserId, origin: "storefront" }, command,
      { clock: () => now, store: () => { throw new Error("redis_must_not_be_used"); } }));
    const before = await prisma.serviceAppointment.findMany({ where: { merchantId: row.merchantId }, include: { payments: true } });
    await t.test("closed admissions do not re-quote the buyer's own confirmed occupied slot", async () => {
      await prisma.serviceBusinessPolicy.update({ where: { merchantId: row.merchantId }, data: { admissionsEnabled: false, version: 2 } });
      const resumed = await start(); assert.equal(resumed.status, 201, JSON.stringify(resumed));
      assert.equal(Object.hasOwn(resumed.body, "service_slot_hold"), false);
      assert.equal(resumed.body.session_id, row.sessionId); assert.equal(resumed.body.global_user_id, row.globalUserId);
      const response = await fetch(runtime.apiOrigin + "/checkout/checkout/" + row.merchantId + "/" + row.sessionId,
        { redirect: "error", signal: AbortSignal.timeout(15_000) });
      assert.equal(response.status, 200); const body = await response.json(); assert.equal(Object.hasOwn(body, "serviceSlotHold"), false);
      assert.deepEqual(await prisma.serviceAppointment.findMany({ where: { merchantId: row.merchantId }, include: { payments: true } }), before);
      assert.equal(before[0].id, confirmed.appointments[0].id); assert.equal(before[0].payments[0].status, "pending");
      assert.equal(await prisma.appointmentAudit.count({ where: { commandId: command.commandId } }), 1);
      assert.equal(await prisma.paymentIntent.count(), 0); assert.equal(await prisma.inventoryMovement.count(), 0);
    });
    assert.equal(runtime.evidence().providerCalls, 0);
  } finally { try { if (raw) await raw.$disconnect(); } finally { await runtime.close(); } }
  assert.deepEqual(runtime.cleanupEvidence(), { appClosed: true, remainingContainers: 0, remainingBridgeSockets: 0 });
});
