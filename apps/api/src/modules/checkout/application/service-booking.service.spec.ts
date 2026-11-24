import assert from "node:assert/strict";
import { modeledUnitServiceRelease } from "../../../../tests/service-release-modeled-unit.fixture.mjs";
import { test } from "node:test";
import { createHash } from "node:crypto";
import { ServiceBookingService } from "./service-booking.service.js";
import { professionalSlotId } from "../../../shared/bookings/service-checkout-selection.js";
import { professionalHoldRequests } from "../../../shared/bookings/service-checkout-selection.js";
import { slotFingerprint, type ActiveSlotLeaseProof, type SlotHold, type SlotRequest } from "../../../shared/bookings/redis-service-slots.js";
import { professionalScheduleSnapshot } from "../../../shared/bookings/service-checkout-cart.js";
import { serviceBookingParentFingerprint } from "../../../shared/bookings/service-checkout-provenance.js";
import { ServiceSlotHoldsService } from "../../../shared/bookings/service-slot-holds.service.js";
import { CheckoutSessionEntity } from "../domain/entities/checkout-session.entity.js";
import { paymentCartFingerprint } from "../domain/services/payment-cart-fingerprint.js";
import { StartCheckoutUseCase } from "./use-cases/start-checkout.use-case.js";
import { ConflictException, ServiceUnavailableException } from "@nestjs/common";

// Bounded memory persistence proves read/selection outcomes. Real HTTP, SQL
// locking, rollback, leases and command replay belong to the native companion.
function fixture(holdEnabled = false) {
  const now = new Date("2035-02-01T12:00:00.000Z"), date = "2035-02-05";
  const policy = { merchantId: "merchant", admissionsEnabled: true, holdEnabled, holdMinutes: holdEnabled ? 4 : null,
    paymentMode: "at_attendance" as const, version: 2, configuredAt: now };
  const professional = { id: "professional", merchantId: "merchant", publicName: "Public professional", version: 3,
    timeZone: "America/Sao_Paulo", isPublished: true, isActive: true,
    publicProfile: { description: "Public biography", specialties: ["Consulting"], privateSecret: "never-public" } };
  const variant = { id: "variant", productId: "product", sku: "SERVICE", isActive: true,
    price: { basePriceInCents: 5000, currency: "BRL" }, media: [] };
  const product = { id: "product", merchantId: "merchant", name: "Public consultation", type: "service", isActive: true,
    deletedAt: null, categoryId: null, category: null, metadata: { serviceSchedule: { durationMinutes: 20, timeZone: professional.timeZone, slots: [] } }, variants: [variant] };
  const link = { id: "link", merchantId: "merchant", professionalId: professional.id, productId: product.id,
    isActive: true, professional, product };
  const state = { now, cart: undefined as any, checkout: undefined as any, active: [] as any[], writes: 0,
    storeError: undefined as Error | undefined, afterLock: undefined as (() => void) | undefined };
  const scope = { merchantId: "merchant", sessionId: "checkout", cartRef: "conversation", expiresAtUnix: Date.parse("2035-02-01T13:00:00Z") / 1000,
    allowedOrigin: "https://booking.example.test", buyer: { globalUserId: "buyer", customer: { email: "buyer@example.test", email_verified: true as const, fullName: "Synthetic buyer" } } };
  const tx: any = {
    $queryRaw: async (query: any, ...values: unknown[]) => {
      const text = Array.isArray(query) ? query.join("?") : query.sql ?? query.text ?? "";
      if (text.includes("clock_timestamp")) return [{ now: new Date(state.now) }];
      if (state.afterLock) { const effect = state.afterLock; state.afterLock = undefined; effect(); }
      return [{ id: text.includes("service_professionals") ? professional.id : "merchant" }];
    },
    $executeRaw: async () => 0,
    merchant: { findUnique: async () => ({ businessMode: "services", businessModeSelectedAt: now, businessModeNeedsReview: false }),
      findUniqueOrThrow: async () => ({ businessMode: "services", businessModeSelectedAt: now, businessModeNeedsReview: false }) },
    serviceBusinessPolicy: { findUnique: async () => structuredClone(policy) },
    professionalService: { findFirst: async ({ where }: any) => where.merchantId === "merchant" && where.professionalId === professional.id && where.productId === product.id ? structuredClone(link) : null,
      findMany: async () => professional.isPublished && professional.isActive ? [structuredClone(link)] : [] },
    serviceProfessional: { findFirst: async () => structuredClone(professional), findMany: async () => [structuredClone(professional)] },
    product: { findFirst: async () => structuredClone(product), findMany: async () => [structuredClone(product)] },
    productVariant: { findFirst: async () => structuredClone(variant), findMany: async () => [{ ...structuredClone(variant), product: structuredClone(product) }] },
    professionalAvailability: { findMany: async () => Array.from({ length: 7 }, (_, weekday) => ({ weekday, startMinute: 600, endMinute: 720, timeZone: professional.timeZone, validFrom: null, validUntil: null })) },
    availabilityException: { findMany: async () => [] }, serviceAppointment: { findMany: async () => [] },
    serviceReservation: { findFirst: async () => null },
    // New service-only payment fence reads the canonical store. This fixture
    // represents no admitted online intent; existing assertions remain intact.
    paymentIntent: { findFirst: async () => null },
    buyerAccount: { findUnique: async () => ({ globalUserId: "buyer", email: "buyer@example.test" }) },
    checkoutSession: { findUnique: async () => structuredClone(state.checkout), findFirst: async () => structuredClone(state.checkout) },
    storefrontCart: { findUnique: async () => structuredClone(state.cart),
      upsert: async () => { state.writes++; throw new Error("selection_must_not_write"); },
      update: async () => { state.writes++; throw new Error("selection_must_not_write"); } },
  };
  const prisma: any = { ...tx, $transaction: async (work: (tx: any) => unknown) => work(tx) };
  const service = new ServiceBookingService(prisma, { execute: async () => { throw new Error("read_must_not_start_checkout"); } } as never,
    {} as never, () => {
      if (!policy.holdEnabled) throw new Error("hold_off_must_not_access_redis");
      return { active: async () => { if (state.storeError) throw state.storeError; return structuredClone(state.active); } } as never;
    });
  const input = { productId: product.id, variantId: variant.id, professionalId: professional.id, date };
  return { service, state, scope, input, policy, professional, product, variant, prisma, tx };
}

/** Memory-store contract only. Scope, target and expiry come from the same
 * modeled lease used by get(); no missing/expired lease becomes acceptance. */
function modeledActiveLease(f: ReturnType<typeof fixture>, lease: SlotHold | undefined,
  merchantId: string, sessionId: string, requested: SlotRequest[]): ActiveSlotLeaseProof {
  if (f.state.storeError) throw f.state.storeError;
  if (merchantId !== f.scope.merchantId || sessionId !== f.scope.sessionId || !lease
    || !requested.length || !Number.isFinite(Date.parse(lease.expiresAt))
    || Date.parse(lease.expiresAt) <= f.state.now.getTime()
    || slotFingerprint(lease.slots) !== slotFingerprint(requested))
    throw new ConflictException("checkout_service_hold_expired");
  const fingerprint = slotFingerprint(lease.slots);
  return { merchantId, ownerHash: createHash("sha256").update(sessionId).digest("hex"),
    generation: "00000000-0000-4000-8000-000000000009", fingerprint, selectionFingerprint: fingerprint,
    expiresAt: lease.expiresAt, slots: structuredClone(lease.slots) };
}

const originalFixture = fixture;
function modeledFixture(context: { after: (callback: () => void) => unknown }, ...args: Parameters<typeof originalFixture>) {
  const f = originalFixture(...args), modeledLedger = modeledUnitServiceRelease(context);
  f.tx.$queryRaw = modeledLedger.wrapQueryRaw(f.tx.$queryRaw) as typeof f.tx.$queryRaw;
  return Object.assign(f, { modeledLedger });
}

test("T40 service selection", async t => {
  await t.test("eligible public professionals never reveal private profile fields", async () => {
    const f = fixture();
    const result = await f.service.professionals(f.scope, { productId: f.product.id, variantId: f.variant.id });
    assert.equal(result.professionals.length, 1); assert.equal(result.professionals[0].id, f.professional.id);
    assert.equal(result.professionals[0].name, f.professional.publicName); assert.equal(result.has_more, false);
    assert.equal(JSON.stringify(result).includes("privateSecret"), false); assert.equal(f.state.writes, 0);
  });
  await t.test("OFF returns exact current dated choices without touching the Redis port", async () => {
    const f = fixture(), result = await f.service.slots(f.scope, f.input), selected = result.selections[0]!;
    assert.equal(selected.professionalId, f.professional.id); assert.equal(selected.professionalVersion, 3);
    assert.equal(selected.policyVersion, 2); assert.equal(selected.date, f.input.date);
    assert.equal(selected.startsAt, "2035-02-05T13:00:00.000Z"); assert.equal(selected.endsAt, "2035-02-05T13:20:00.000Z");
    assert.equal(selected.timeZone, "America/Sao_Paulo"); assert.equal(selected.durationMinutes, 20);
    assert.equal(selected.priceInCents, 5000); assert.equal(selected.currency, "BRL");
    assert.equal(selected.slotId, professionalSlotId("merchant", selected)); assert.equal(f.state.writes, 0);
  });
  await t.test("selection shows all named facts and full parent identity without any mutation", async () => {
    const f = fixture(), choice = (await f.service.slots(f.scope, f.input)).selections[0]!;
    const before = structuredClone(f.state), result = await f.service.select(f.scope, { selection: choice });
    assert.deepEqual(result.selection, choice); assert.deepEqual(result.service, { name: f.product.name });
    assert.deepEqual(result.professional, { name: f.professional.publicName });
    assert.equal(result.policy.version, 2); assert.equal(result.policy.paymentMode, "at_attendance"); assert.equal(result.policy.holdEnabled, false);
    assert.match(result.parent_cart_fingerprint, /^[a-f0-9]{64}$/); assert.deepEqual(f.state, before);
  });
  await t.test("temporary foreign overlap removes slots and dates only when policy enables holds", async () => {
    const f = fixture(true), all = (await f.service.slots(f.scope, f.input)).selections;
    f.state.active = [{ owner: createHash("sha256").update("foreign-checkout").digest("hex"), slots: all.map(x => ({ resourceId: "professional:" + x.professionalId, slotId: x.slotId, startsAt: x.startsAt, endsAt: x.endsAt })) }];
    const blocked = await f.service.slots(f.scope, f.input); assert.deepEqual(blocked.selections, []);
    const dates = await f.service.dates(f.scope, { ...f.input, fromDate: f.input.date, toDate: f.input.date });
    assert.deepEqual(dates.dates, []); assert.equal(f.state.writes, 0);
  });
  await t.test("Redis failure stays unavailable rather than returning falsely free slots", async () => {
    const f = fixture(true); f.state.storeError = new Error("synthetic_owned_redis_unavailable");
    await assert.rejects(() => f.service.slots(f.scope, f.input), /synthetic_owned_redis_unavailable|service_schedule_temporarily_unavailable/);
    assert.equal(f.state.writes, 0);
  });
  await t.test("foreign IDs are denied without public label disclosure or mutation", async () => {
    const f = fixture(); await assert.rejects(() => f.service.slots(f.scope, { ...f.input, professionalId: "foreign" }), /service_professional_not_found|professional_service_not_found/);
    assert.equal(f.state.writes, 0); assert.equal(f.state.cart, undefined);
  });
  await t.test("policy, professional and price changes invalidate the old acceptance", async () => {
    const f = fixture(), choice = (await f.service.slots(f.scope, f.input)).selections[0]!;
    f.policy.version = 3; await assert.rejects(() => f.service.select(f.scope, { selection: choice }), /service_policy_changed/);
    f.policy.version = 2; f.professional.version = 4; await assert.rejects(() => f.service.select(f.scope, { selection: choice }), /service_selection_stale/);
    f.professional.version = 3; f.variant.price.basePriceInCents = 5500;
    await assert.rejects(() => f.service.select(f.scope, { selection: choice }), /service_offer_changed/); assert.equal(f.state.writes, 0);
  });
  await t.test("fresh database time after the lock refuses an expired private capability", async () => {
    const f = fixture(); f.state.afterLock = () => { f.state.now = new Date(f.scope.expiresAtUnix * 1000); };
    await assert.rejects(() => f.service.slots(f.scope, f.input), /embed_session_token_expired/);
    assert.equal(f.state.writes, 0); assert.equal(f.state.cart, undefined); assert.equal(f.state.checkout, undefined);
  });
  await t.test("real Start and Holds never reacquire for a read-only initial winner; only explicit review may acquire", async t => {
    const fixture = (...args: Parameters<typeof originalFixture>) => modeledFixture(t, ...args);
    // Declared memory boundary: the bootstrap double supplies the raced winner;
    // actual Start and Holds own their behavior, canonical facts and store effects.
    const f = fixture(true), selected = (await f.service.slots(f.scope, f.input)).selections[0]!;
    const cart = { source: "storefront" as const, cart_ref: f.scope.cartRef, total: 50, currency: "BRL" as const,
      items: [{ sku: f.variant.sku, product_id: f.product.id, variantId: f.variant.id, name: f.product.name,
        quantity: 1, price: 50, productType: "service" as const, fulfillmentStrategy: "scheduled_service" as const,
        fulfillmentSchedule: professionalScheduleSnapshot(selected) }] };
    const session = CheckoutSessionEntity.create({ merchantId: f.scope.merchantId, sessionId: f.scope.sessionId,
      globalUserId: f.scope.buyer.globalUserId, conversationId: "memory-winner", cart, customer: f.scope.buyer.customer }).snapshot();
    f.state.checkout = { ...structuredClone(session), cart: JSON.parse(JSON.stringify(cart)), createdAt: new Date(session.createdAt), updatedAt: new Date(session.updatedAt) };
    f.state.cart = { items: [{ variantId: f.variant.id, productId: f.product.id, name: f.product.name, sku: f.variant.sku,
      quantity: 1, unitPriceCents: 5000, selectedServiceSlot: professionalScheduleSnapshot(selected) }], total: 5000,
      discount: 0, couponCode: null, freeShipping: false, expiresAt: new Date("2035-03-01T00:00:00Z") };
    f.tx.completedOrder = { findFirst: async () => null }; f.tx.appointmentAudit = { findFirst: async () => null };
    const ledger = { writes: 0, lease: undefined as any }, slots = professionalHoldRequests([selected]);
    const holds = new ServiceSlotHoldsService(f.prisma, { get: async () => structuredClone(ledger.lease),
      assertActive: async (merchantId: string, sessionId: string, requested: SlotRequest[]) => modeledActiveLease(f, ledger.lease, merchantId, sessionId, requested),
      acquire: async () => { ledger.writes++; ledger.lease = { expiresAt: "2035-02-01T12:04:00.000Z", slots }; return structuredClone(ledger.lease); } } as never);
    const sessions = { getSession: async () => structuredClone(session), saveSession: async () => { throw new Error("readonly_winner_must_not_save"); } };
    const start = new StartCheckoutUseCase(sessions as never, {} as never, { load: async () => ({}) } as never,
      { bootstrap: async () => ({ session: structuredClone(session), readonlyBookingReplay: true }) } as never, {} as never,
      undefined, undefined, undefined, undefined, undefined, { resolveStorefront: async () => structuredClone(cart) } as never,
      undefined, undefined, undefined, holds);
    const capability = { merchantId: f.scope.merchantId, sessionId: f.scope.sessionId, globalUserId: f.scope.buyer.globalUserId,
      expiresAtUnix: f.scope.expiresAtUnix, allowedOrigin: f.scope.allowedOrigin, cartFingerprint: paymentCartFingerprint(session),
      storefrontCartRef: f.scope.cartRef, parentCartFingerprint: serviceBookingParentFingerprint(f.state.cart) };
    const context = { serverChannel: "storefront" as const, storefrontCartRef: f.scope.cartRef, trustedBuyer: f.scope.buyer,
      requireBuyerProof: true, bookingCapability: capability };
    const before = structuredClone(f.state);
    await assert.rejects(() => start.execute({ merchant_id: f.scope.merchantId, session_id: f.scope.sessionId, cart }, context), /service_hold_required/);
    assert.deepEqual(f.state, before); assert.equal(ledger.writes, 0); assert.equal(ledger.lease, undefined);
    ledger.lease = { expiresAt: "2035-02-01T12:04:00.000Z", slots }; const active = structuredClone(ledger);
    const result = await start.execute({ merchant_id: f.scope.merchantId, session_id: f.scope.sessionId, cart }, context);
    assert.deepEqual(result.service_slot_hold, active.lease); assert.deepEqual(ledger, active); assert.deepEqual(f.state, before);
    ledger.lease = { expiresAt: "2035-02-01T11:59:59.000Z", slots }; const expired = structuredClone(ledger);
    await assert.rejects(() => start.execute({ merchant_id: f.scope.merchantId, session_id: f.scope.sessionId, cart }, context), /service_hold_required/);
    assert.deepEqual(ledger, expired); assert.deepEqual(f.state, before);
    ledger.lease = undefined;
    const reviewed = await start.execute({ merchant_id: f.scope.merchantId, session_id: f.scope.sessionId, cart },
      { ...context, bookingCapability: { ...capability, leaseIntent: "review_checkout" } });
    assert.equal(ledger.writes, 1); assert.ok(reviewed.service_slot_hold); assert.deepEqual(f.state, before);
  });
  await t.test("preparation re-observes only a known winner conflict; active and still-missing states remain truthful", async t => {
    const fixture = (...args: Parameters<typeof originalFixture>) => modeledFixture(t, ...args);
    for (const active of [false, true]) {
      const f = fixture(true), choice = (await f.service.slots(f.scope, f.input)).selections[0]!, schedule = professionalScheduleSnapshot(choice);
      const source = { items: [{ variantId: f.variant.id, productId: f.product.id, name: f.product.name, sku: f.variant.sku,
        quantity: 1, unitPriceCents: 5000, selectedServiceSlot: schedule }], total: 5000, discount: 0, couponCode: null, freeShipping: false };
      f.state.cart = { ...source, expiresAt: new Date("2035-03-01T00:00:00Z") };
      const cart = { source: "storefront" as const, cart_ref: f.scope.cartRef, total: 50, currency: "BRL" as const,
        items: [{ sku: f.variant.sku, product_id: f.product.id, variantId: f.variant.id, name: f.product.name, quantity: 1, price: 50,
          productType: "service" as const, fulfillmentStrategy: "scheduled_service" as const, fulfillmentSchedule: schedule }] };
      const session = CheckoutSessionEntity.create({ merchantId: f.scope.merchantId, sessionId: f.scope.sessionId, globalUserId: f.scope.buyer.globalUserId,
        conversationId: "memory-convergence", cart, customer: f.scope.buyer.customer }).snapshot();
      const winner = { ...structuredClone(session), createdAt: new Date(session.createdAt), updatedAt: new Date(session.updatedAt), serviceOrigin: "storefront", serviceOriginProof: { schemaVersion: 1,
        merchantId: session.merchantId, sessionId: session.sessionId, globalUserId: session.globalUserId, authority: "storefront_entrypoint" } };
      f.tx.completedOrder = { findFirst: async () => null }; f.tx.appointmentAudit = { findFirst: async () => null };
      const lease = { expiresAt: "2035-02-01T12:04:00.000Z", slots: professionalHoldRequests([choice]) }, ledger = { writes: 0 };
      const holds = new ServiceSlotHoldsService(f.prisma, { get: async () => active ? structuredClone(lease) : undefined,
        assertActive: async (merchantId: string, sessionId: string, requested: SlotRequest[]) => modeledActiveLease(f, active ? lease : undefined, merchantId, sessionId, requested),
        acquire: async () => { ledger.writes++; throw new Error("reobservation_must_not_acquire"); } } as never);
      // The Start double represents the already-persisted competing creator;
      // no HTTP/SQL-race claim is made by this memory case.
      let failure: Error = new ConflictException({ code: "service_hold_required", message: "service_hold_required", next_action: "review_checkout" });
      const service = new ServiceBookingService(f.prisma, { execute: async () => { f.state.checkout = structuredClone(winner); throw failure; } } as never,
        holds, () => ({ active: async () => [],
          assertActive: async (merchantId: string, sessionId: string, requested: SlotRequest[]) => modeledActiveLease(f, active ? lease : undefined, merchantId, sessionId, requested) }) as never);
      const command = { selection: choice, parent_cart_fingerprint: serviceBookingParentFingerprint({ items: [], total: 0, discount: 0, couponCode: null, freeShipping: false }) };
      if (active) {
        const result = await service.prepare(f.scope, command); assert.equal(result.session_id, session.sessionId);
        assert.equal(result.replayed, true); assert.deepEqual(result.service_slot_hold, lease);
      } else await assert.rejects(() => service.prepare(f.scope, command), (error: unknown) => {
        assert.ok(error instanceof ConflictException);
        assert.equal(error.getStatus(), 409);
        const response = error.getResponse();
        assert.ok(typeof response === "object" && response !== null);
        assert.equal((response as Record<string, unknown>).code, "service_hold_required");
        assert.equal((response as Record<string, unknown>).next_action, "review_checkout");
        return true;
      });
      assert.equal(ledger.writes, 0); assert.equal(f.state.writes, 0); assert.deepEqual(f.state.checkout, winner);
      assert.deepEqual(f.state.cart, { ...source, expiresAt: new Date("2035-03-01T00:00:00Z") });
      f.state.checkout = undefined; failure = new ServiceUnavailableException("service_schedule_temporarily_unavailable");
      await assert.rejects(() => service.prepare(f.scope, command), /service_schedule_temporarily_unavailable/);
      assert.equal(ledger.writes, 0); assert.equal(f.state.writes, 0);
    }
  });
});
