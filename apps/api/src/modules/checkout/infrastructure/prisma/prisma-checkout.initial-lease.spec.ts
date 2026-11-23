import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { PrismaCheckoutRepository } from "./prisma-checkout.repository.js";
import { CheckoutSessionEntity } from "../../domain/entities/checkout-session.entity.js";
import { professionalSlotId, professionalHoldRequests } from "../../../../shared/bookings/service-checkout-selection.js";
import { professionalScheduleSnapshot, professionalStorefrontSlot } from "../../../../shared/bookings/service-checkout-cart.js";
import { serviceBookingParentFingerprint, serviceCheckoutProvenance } from "../../../../shared/bookings/service-checkout-provenance.js";
import { paymentCartFingerprint } from "../../domain/services/payment-cart-fingerprint.js";
import { initialLeaseMemory } from "../../../../../tests/initial-lease-memory.fixture.js";

// Component-level real repository/canonical readers + bounded persistence and
// Redis protocol doubles. SQL/Lua concurrency proof is the additive native child.
function fixture(holdEnabled = true) {
  const now = new Date(), date = new Date(now.getTime() + 2 * 86400000).toISOString().slice(0, 10);
  const selection = { productId: "product", variantId: "variant", professionalId: "professional", professionalVersion: 3, policyVersion: 2,
    date, startsAt: date + "T13:00:00.000Z", endsAt: date + "T13:20:00.000Z", timeZone: "America/Sao_Paulo", durationMinutes: 20, priceInCents: 5000, currency: "BRL", slotId: "" };
  selection.slotId = professionalSlotId("merchant", selection);
  const cart: any = { source: "storefront", cart_ref: "parent", currency: "BRL", total: 50, items: [{ product_id: "product", variantId: "variant", sku: "SERVICE", name: "Consulta", quantity: 1, price: 50,
    productType: "service", fulfillmentStrategy: "scheduled_service", fulfillmentSchedule: professionalScheduleSnapshot(selection) }] };
  const session = CheckoutSessionEntity.create({ merchantId: "merchant", sessionId: "checkout", globalUserId: "buyer", conversationId: "conversation", cart,
    customer: { email: "buyer@example.test", email_verified: true } }).snapshot();
  const source: any = { merchantId: "merchant", sessionId: "parent", items: [{ productId: "product", variantId: "variant", sku: "SERVICE", name: "Consulta", quantity: 1, unitPriceCents: 5000,
    selectedServiceSlot: professionalStorefrontSlot(selection) }], total: 5000, discount: 0, couponCode: null, freeShipping: false, expiresAt: new Date(now.getTime() + 3600000) };
  const identity: any = { serverChannel: "storefront", trustedBuyer: { globalUserId: "buyer", customer: session.customer }, bookingCapability: {
    merchantId: "merchant", sessionId: "checkout", globalUserId: "buyer", allowedOrigin: "https://store.example.test", expiresAtUnix: Math.floor(now.getTime() / 1000) + 3600,
    cartFingerprint: paymentCartFingerprint(session), storefrontCartRef: "parent", parentCartFingerprint: serviceBookingParentFingerprint(source) } };
  const policy = { merchantId: "merchant", holdEnabled, holdMinutes: holdEnabled ? 4 : null, admissionsEnabled: true, paymentMode: "at_attendance", version: 2, configuredAt: now };
  const professional = { id: "professional", merchantId: "merchant", publicName: "Profissional", version: 3, timeZone: selection.timeZone, isActive: true, isPublished: true };
  const variant = { id: "variant", productId: "product", sku: "SERVICE", isActive: true, price: { basePriceInCents: 5000, currency: "BRL" }, media: [] };
  const product = { id: "product", merchantId: "merchant", name: "Consulta", type: "service", isActive: true, deletedAt: null, categoryId: null, category: null,
    metadata: { serviceSchedule: { durationMinutes: 20, timeZone: selection.timeZone, slots: [] } }, variants: [variant] };
  const lease = initialLeaseMemory(), trace: string[] = [];
  const state = { row: undefined as any, active: false, now, failure: undefined as Error | undefined, commitFailure: undefined as Error | undefined,
    beforeInsert: undefined as (() => void) | undefined, storeCalls: 0 };
  lease.state.onRelease = () => { assert.equal(state.active, true, "compensation must occur before the SQL callback releases its locks"); trace.push("lease.compensate"); };
  const row = (data: any) => ({ ...structuredClone(data), id: "checkout-row", createdAt: new Date(data.createdAt ?? now), updatedAt: new Date(data.updatedAt ?? now), version: 1 });
  const tx: any = { $queryRaw: async (sql: any) => { const text = Array.isArray(sql) ? sql.join("?") : sql.sql ?? sql.text ?? "";
      if (text.includes("clock_timestamp")) { trace.push("clock"); return [{ now: new Date(state.now) }]; }
      if (text.includes("FROM merchants")) trace.push("merchant.lock"); if (text.includes("pg_advisory_xact_lock")) trace.push("session.lock");
      return [{ id: text.includes("service_professionals") ? "professional" : "merchant" }]; },
    $executeRaw: async () => { trace.push("source.lock"); return 0; },
    merchant: { findUniqueOrThrow: async () => ({ businessMode: "services", businessModeSelectedAt: now, businessModeNeedsReview: false }) },
    serviceBusinessPolicy: { findUnique: async () => structuredClone(policy) },
    professionalService: { findFirst: async () => ({ id: "professional-service", merchantId: "merchant", professionalId: "professional", productId: "product", isActive: true, professional, product }) },
    serviceProfessional: { findFirst: async () => professional }, product: { findFirst: async () => product }, productVariant: { findFirst: async () => variant },
    professionalAvailability: { findMany: async () => Array.from({ length: 7 }, (_, weekday) => ({ weekday, startMinute: 600, endMinute: 720, timeZone: selection.timeZone, validFrom: null, validUntil: null })) },
    availabilityException: { findMany: async () => [] }, serviceAppointment: { findMany: async () => [] }, serviceReservation: { findFirst: async () => null },
    storefrontCart: { findUnique: async () => source },
    checkoutSession: { findUnique: async () => state.row,
      upsert: async ({ create }: any) => { trace.push("sql.publish"); if (holdEnabled) assert.ok(lease.state.held, "initial lease must exist BEFORE SQL checkout publication"); state.beforeInsert?.(); if (state.failure) throw state.failure; state.row = row(create); return state.row; },
      create: async ({ data }: any) => { trace.push("sql.publish"); if (holdEnabled) assert.ok(lease.state.held, "initial lease before SQL create"); state.beforeInsert?.(); if (state.failure) throw state.failure; state.row = row(data); return state.row; } },
  };
  const prisma: any = { $transaction: async (work: (value: any) => Promise<any>) => { const before = state.row; state.active = true;
    try { const result = await work(tx); if (state.commitFailure) throw state.commitFailure; return result; }
    catch (error) { if (error !== state.commitFailure) state.row = before; throw error; } finally { state.active = false; } } };
  const repo = new PrismaCheckoutRepository(prisma, false, undefined, () => { state.storeCalls++; if (!holdEnabled) throw Error("OFF_must_not_touch_store"); return lease.store; });
  const seedWinner = () => { state.row = row({ ...session, ...serviceCheckoutProvenance(session, identity), cart: structuredClone(cart) }); };
  return { repo, session, identity, state, lease, trace, source, seedWinner, selections: [selection], request: () => repo.createSessionIfAbsent(session, identity) };
}

test("T40 canonical creator publishes its initial lease before SQL and compensates only known callback failure", async t => {
  await t.test("creator publication already has an original lease and following ordinary acquire is idempotent", async () => {
    const f = fixture(), result = await f.request(); assert.equal(result.created, true); assert.ok(f.state.row); assert.ok(f.lease.state.held);
    const original = structuredClone(f.lease.state.held), again = await f.lease.store.acquire("merchant", "checkout", professionalHoldRequests(f.selections), 240000);
    assert.equal(again.expiresAt, new Date(original.expiresAt).toISOString()); assert.deepEqual(f.lease.state.held, original); assert.equal(f.lease.state.releaseCalls, 0);
  });
  await t.test("OFF publishes without obtaining or touching a Redis store", async () => { const f = fixture(false), result = await f.request(); assert.equal(result.created, true); assert.equal(f.state.storeCalls, 0); assert.equal(f.lease.state.acquireCalls, 0); assert.equal(f.lease.state.releaseCalls, 0); });
  await t.test("persisted read-only winner with missing lease never acquires or renews", async () => { const f = fixture(); f.seedWinner(); const before = structuredClone(f.state.row), result = await f.request(); assert.equal(result.created, false); assert.equal(f.state.storeCalls, 0); assert.equal(f.lease.state.acquireCalls, 0); assert.deepEqual(f.state.row, before); });
  await t.test("known insert failure compensates the new original target while callback locks remain held", async () => { const f = fixture(); f.state.failure = Error("known_sql_insert_failure"); await assert.rejects(f.request(), error => error === f.state.failure); assert.equal(f.state.row, undefined); assert.equal(f.lease.state.held, undefined); assert.equal(f.lease.state.releaseCalls, 1); assert.ok(f.trace.includes("lease.compensate")); });
  await t.test("a borrowed prior generation is not compensation authority on callback failure", async () => { const f = fixture(); f.lease.seed(professionalHoldRequests(f.selections), createHash("sha256").update("checkout").digest("hex")); const original = structuredClone(f.lease.state.held); f.state.failure = Error("known_failure_borrowed"); await assert.rejects(f.request(), error => error === f.state.failure); assert.deepEqual(f.lease.state.held, original); assert.equal(f.lease.state.releaseCalls, 0); });
  await t.test("replacement generation cannot be released by a failed creator of identical terms", async () => { const f = fixture(); f.state.beforeInsert = () => f.lease.replace(); f.state.failure = Error("known_failure_replaced"); await assert.rejects(f.request(), error => error === f.state.failure); assert.equal(f.lease.state.held.generation, "22222222-2222-4222-8222-222222222222"); assert.equal(f.lease.state.releaseCalls, 0); });
  await t.test("unknown Redis acknowledgement never publishes SQL or guesses a compensation", async () => { const f = fixture(); f.lease.state.loseAck = true; await assert.rejects(f.request()); assert.equal(f.state.row, undefined); assert.ok(f.lease.state.held); assert.equal(f.lease.state.releaseCalls, 0); });
  await t.test("unknown commit acknowledgement outside callback preserves the committed winner and lease", async () => { const f = fixture(); f.state.commitFailure = Error("commit_ack_unknown"); await assert.rejects(f.request(), error => error === f.state.commitFailure); assert.ok(f.state.row); assert.ok(f.lease.state.held); assert.equal(f.lease.state.releaseCalls, 0); });
  await t.test("fresh DB capability after Redis rejects expiry and compensates only its own new generation", async () => { const f = fixture(); f.lease.state.beforeReturn = () => { f.state.now = new Date((f.identity.bookingCapability.expiresAtUnix + 1) * 1000); }; await assert.rejects(f.request(), /embed_session_token_expired/); assert.equal(f.state.row, undefined); assert.equal(f.lease.state.held, undefined); assert.equal(f.lease.state.releaseCalls, 1); });
});
