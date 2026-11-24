import assert from "node:assert/strict";
import { modeledUnitServiceRelease } from "../../../tests/service-release-modeled-unit.fixture.mjs";
import test from "node:test";
import { ConflictException } from "@nestjs/common";
import type { PrismaClient } from "@prisma/client";
import type { CheckoutSession } from "@zyon/shared-types";
import type { ServicePaymentMode } from "../../modules/merchant/domain/service-business-policy.js";
import { ServiceSlotHoldsService } from "./service-slot-holds.service.js";
import type { RedisServiceSlots, SlotRequest } from "./redis-service-slots.js";

// Component unit storage only. Actual journal transactions, leases, auth and
// zero-effect boundaries are proved in the native HTTP/SQL/Redis companions.
function fixture(paymentMode: ServicePaymentMode, holdEnabled: boolean, missingLease = false) {
  const now = new Date(), date = new Date(now.getTime() + 2 * 86_400_000).toISOString().slice(0, 10);
  const session: CheckoutSession = { merchantId: "services", sessionId: "payment-selection", globalUserId: "buyer",
    conversationId: "synthetic", abandonmentScore: 0, triggerAgent: false, chatHistory: [],
    createdAt: now.toISOString(), updatedAt: now.toISOString(), cart: { currency: "BRL", total: 50, items: [{
      sku: "service", product_id: "service", variantId: "variant", name: "Synthetic service", productType: "service",
      fulfillmentStrategy: "scheduled_service", price: 50, quantity: 1, fulfillmentSchedule: {
        slotId: "display", professionalId: "professional", professionalVersion: 1, policyVersion: 1, date,
        startsAt: date + "T10:00:00.000Z", endsAt: date + "T10:20:00.000Z", timeZone: "America/Sao_Paulo", durationMinutes: 20 } }] } };
  const policy = { admissionsEnabled: true, configuredAt: now, version: 1, holdEnabled,
    holdMinutes: holdEnabled ? 4 : null, paymentMode };
  const variant = { id: "variant", productId: "service", isActive: true, price: { basePriceInCents: 5000, currency: "BRL" } };
  const tx = {
    $queryRaw: async () => [{ id: "services" }],
    checkoutSession: { findUnique: async () => ({ cart: session.cart, globalUserId: session.globalUserId }) },
    completedOrder: { findFirst: async () => null },
    appointmentAudit: { findFirst: async () => null },
    merchant: { findUnique: async () => ({ businessMode: "services", businessModeSelectedAt: now, businessModeNeedsReview: false }),
      findUniqueOrThrow: async () => ({ businessMode: "services", businessModeSelectedAt: now, businessModeNeedsReview: false }) },
    serviceReservation: { findFirst: async () => null },
    serviceBusinessPolicy: { findUnique: async () => policy },
    productVariant: { findFirst: async () => variant },
    professionalService: { findFirst: async () => ({ id: "link", merchantId: "services", professionalId: "professional", productId: "service", isActive: true,
      professional: { id: "professional", merchantId: "services", isActive: true, isPublished: true, timeZone: "America/Sao_Paulo", version: 1 },
      product: { id: "service", merchantId: "services", type: "service", isActive: true, deletedAt: null, categoryId: null, category: null,
        metadata: { serviceSchedule: { timeZone: "America/Sao_Paulo", durationMinutes: 20, slots: [] } }, variants: [variant] } }) },
    professionalAvailability: { findMany: async () => Array.from({ length: 7 }, (_, weekday) => ({ weekday, startMinute: 420, endMinute: 480,
      timeZone: "America/Sao_Paulo", validFrom: null, validUntil: null })) },
    availabilityException: { findMany: async () => [] }, serviceAppointment: { findMany: async () => [], count: async () => 0 },
  };
  const verified: Array<{ merchantId: string; owner: string; slots: SlotRequest[] }> = [];
  const store = { assertActive: async (merchantId: string, owner: string, slots: SlotRequest[]) => {
    verified.push({ merchantId, owner, slots });
    if (missingLease) throw new ConflictException("service_hold_required");
  } } as unknown as RedisServiceSlots;
  const prisma = { $transaction: async (work: (client: typeof tx) => Promise<void>) => work(tx) } as unknown as PrismaClient;
  return { tx, session, verified, service: new ServiceSlotHoldsService(prisma, store) };
}

const originalFixture = fixture;
function modeledFixture(context: { after: (callback: () => void) => unknown }, ...args: Parameters<typeof originalFixture>) {
  const f = originalFixture(...args), modeledLedger = modeledUnitServiceRelease(context);
  f.tx.$queryRaw = modeledLedger.wrapQueryRaw(f.tx.$queryRaw) as typeof f.tx.$queryRaw;
  return Object.assign(f, { modeledLedger });
}

test("T29 payment policy", async t => {
  for (const holdEnabled of [false, true]) await t.test("local-payment rejects PSP admission before lease access with hold=" + holdEnabled, async t => {
    const fixture = (...args: Parameters<typeof originalFixture>) => modeledFixture(t, ...args);
    const f = fixture("at_attendance", holdEnabled);
    await assert.rejects(f.service.assertBeforePayment(f.session, { requireOnline: true }), /service_pay_at_attendance_required/);
    assert.deepEqual(f.verified, []);
  });
  await t.test("online hold-off needs no lease or Redis connection", async t => {
    const fixture = (...args: Parameters<typeof originalFixture>) => modeledFixture(t, ...args);
    const f = fixture("online", false, true);
    await f.service.assertBeforePayment(f.session, { requireOnline: true });
    assert.deepEqual(f.verified, []);
  });
  await t.test("online hold-on binds the persisted buyer session and canonical professional interval", async t => {
    const fixture = (...args: Parameters<typeof originalFixture>) => modeledFixture(t, ...args);
    const f = fixture("online", true);
    await f.service.assertBeforePayment(f.session, { requireOnline: true });
    assert.equal(f.verified.length, 1); assert.equal(f.verified[0].merchantId, "services"); assert.equal(f.verified[0].owner, "payment-selection");
    assert.equal(f.verified[0].slots.length, 1); assert.equal(f.verified[0].slots[0].resourceId, "professional:professional");
    assert.equal(f.verified[0].slots[0].startsAt, f.session.cart.items[0]!.fulfillmentSchedule!.startsAt);
    assert.equal(f.verified[0].slots[0].endsAt, f.session.cart.items[0]!.fulfillmentSchedule!.endsAt);
    assert.match(f.verified[0].slots[0].slotId, /^[a-f0-9]{64}$/);
  });
  await t.test("online hold-on cannot proceed with a missing or expired lease", async t => {
    const fixture = (...args: Parameters<typeof originalFixture>) => modeledFixture(t, ...args);
    const f = fixture("online", true, true);
    await assert.rejects(f.service.assertBeforePayment(f.session, { requireOnline: true }), /service_hold_required/);
  });
  await t.test("an unscheduled service retains its existing payment path", async t => {
    const fixture = (...args: Parameters<typeof originalFixture>) => modeledFixture(t, ...args);
    const f = fixture("at_attendance", false);
    f.session.cart.items[0]!.fulfillmentStrategy = "service"; delete f.session.cart.items[0]!.fulfillmentSchedule;
    await f.service.assertBeforePayment(f.session, { requireOnline: true });
    assert.deepEqual(f.verified, []);
  });
});
