import assert from "node:assert/strict";
import { test } from "node:test";
import { createHash } from "node:crypto";
import { PublicServiceBookingReader } from "./public-service-booking-reader.js";
import { professionalSlotId } from "../../../shared/bookings/service-checkout-selection.js";

// User change 2026-11-24: discovery is public; buyer identity belongs to booking.
// Canonical domain readers run against bounded memory persistence here. Real
// HTTP/SQL/provider proof remains a separate local integration gate.
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
  const state = { now, cart: undefined as any, checkout: undefined as any, active: [] as any[], writes: 0, appointments: [] as any[], exceptions: [] as any[],
    storeError: undefined as Error | undefined, afterLock: undefined as (() => void) | undefined };
  const scope = { merchantId: "merchant", expiresAtUnix: Date.parse("2035-02-01T13:00:00Z") / 1000,
    allowedOrigin: "https://booking.example.test" };
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
    availabilityException: { findMany: async () => structuredClone(state.exceptions) }, serviceAppointment: { findMany: async () => structuredClone(state.appointments) },
    serviceReservation: { findFirst: async () => null },
    // New service-only payment fence reads the canonical store. This fixture
    // represents no admitted online intent; existing assertions remain intact.
    paymentIntent: { findFirst: async () => null },
    buyerAccount: { findUnique: async () => { throw new Error("public_read_must_not_resolve_buyer"); } },
    checkoutSession: { findUnique: async () => { throw new Error("public_read_must_not_read_checkout"); }, findFirst: async () => { throw new Error("public_read_must_not_read_checkout"); } },
    storefrontCart: { findUnique: async () => { throw new Error("public_read_must_not_read_cart"); },
      upsert: async () => { state.writes++; throw new Error("selection_must_not_write"); },
      update: async () => { state.writes++; throw new Error("selection_must_not_write"); } },
  };
  const prisma: any = { ...tx, $transaction: async (work: (tx: any) => unknown) => work(tx) };
  const service = new PublicServiceBookingReader(prisma, () => {
      if (!policy.holdEnabled) throw new Error("hold_off_must_not_access_redis");
      return { active: async () => { if (state.storeError) throw state.storeError; return structuredClone(state.active); } } as never;
    });
  const input = { productId: product.id, variantId: variant.id, professionalId: professional.id, date };
  return { service, state, scope, input, policy, professional, product, variant, prisma, tx };
}

test("public service browsing", async t => {
  await t.test("anonymous roster exposes only published professional fields without a buyer/cart lookup", async () => {
    const f = fixture();
    assert.deepEqual(await f.service.professionals(f.scope, { productId: "product", variantId: "variant" }), {
      professionals: [{ id: "professional", name: "Public professional", version: 3, timeZone: "America/Sao_Paulo",
        profile: { description: "Public biography", specialties: ["Consulting"] } }], has_more: false });
    assert.equal(f.state.writes, 0); assert.equal(f.state.checkout, undefined); assert.equal(f.state.cart, undefined);
  });
  await t.test("anonymous dates and slots retain canonical price, duration, versions and Brasilia instants", async () => {
    const f = fixture(), result = await f.service.slots(f.scope, f.input), first = result.selections[0]!;
    assert.equal(result.selections.length, 6);
    assert.deepEqual(first, { productId: "product", variantId: "variant", professionalId: "professional", professionalVersion: 3,
      policyVersion: 2, date: f.input.date, startsAt: "2035-02-05T13:00:00.000Z", endsAt: "2035-02-05T13:20:00.000Z",
      timeZone: "America/Sao_Paulo", durationMinutes: 20, priceInCents: 5000, currency: "BRL", slotId: professionalSlotId("merchant", first) });
    assert.deepEqual(await f.service.dates(f.scope, { ...f.input, fromDate: f.input.date, toDate: f.input.date }), {
      dates: [f.input.date], professional_version: 3, policy_version: 2, time_zone: "America/Sao_Paulo" });
    assert.equal(/buyer|cart|session|private|email|phone|appointmentId/.test(JSON.stringify(result)), false); assert.equal(f.state.writes, 0);
  });
  await t.test("all live holds occupy capacity, including any owner-shaped legacy guest input", async () => {
    const f = fixture(true), slots = (await f.service.slots(f.scope, f.input)).selections;
    f.state.active = [{ owner: createHash("sha256").update("guest-checkout").digest("hex"), slots: slots.map(value => ({
      resourceId: "professional:" + value.professionalId, slotId: value.slotId, startsAt: value.startsAt, endsAt: value.endsAt })) }];
    const untrustedExtra = { ...f.scope, sessionId: "guest-checkout", holdOwnerId: "guest-checkout", buyer: { globalUserId: "guest" } };
    assert.deepEqual(await f.service.slots(untrustedExtra, f.input), { selections: [] });
    assert.deepEqual((await f.service.dates(f.scope, { ...f.input, fromDate: f.input.date, toDate: f.input.date })).dates, []);
    assert.equal(f.state.writes, 0);
  });
  await t.test("current appointments and manual blocks remove occupied public slots without exposing reservation data", async () => {
    const f = fixture();
    f.state.appointments = [{ startsAt: new Date("2035-02-05T13:00:00Z"), endsAt: new Date("2035-02-05T13:20:00Z"), customerEmail: "private@example.test", id: "private-appointment" }];
    f.state.exceptions = [{ kind: "block", startsAt: new Date("2035-02-05T13:20:00Z"), endsAt: new Date("2035-02-05T13:40:00Z") }];
    const value = await f.service.slots(f.scope, f.input);
    assert.equal(value.selections.length, 4); assert.equal(value.selections[0]!.startsAt, "2035-02-05T13:40:00.000Z");
    assert.equal(/private|appointment|Email/.test(JSON.stringify(value)), false); assert.equal(f.state.writes, 0);
  });
  await t.test("live hold failure remains unavailable rather than showing falsely free capacity", async () => {
    const f = fixture(true); f.state.storeError = new Error("private-redis-error");
    await assert.rejects(() => f.service.slots(f.scope, f.input), /service_schedule_temporarily_unavailable/);
    assert.equal(f.state.writes, 0); assert.equal(f.state.cart, undefined);
  });
  await t.test("hold-off does not contact Redis and still excludes occupied confirmed appointments", async () => {
    const f = fixture(false); f.state.appointments = [{ startsAt: new Date("2035-02-05T13:00:00Z"), endsAt: new Date("2035-02-05T15:00:00Z") }];
    assert.deepEqual(await f.service.slots(f.scope, f.input), { selections: [] }); assert.equal(f.state.writes, 0);
  });
  await t.test("expired or unbound read authority never publishes a roster or writes", async () => {
    const f = fixture();
    for (const scope of [{ ...f.scope, expiresAtUnix: f.state.now.getTime() / 1000 }, { ...f.scope, allowedOrigin: "" }])
      await assert.rejects(() => f.service.professionals(scope, { productId: "product", variantId: "variant" }), /embed_session_token_expired|service_booking_capability_invalid/);
    assert.equal(f.state.writes, 0);
  });
  await t.test("fresh database time after a lock rejects authority that expired while waiting", async () => {
    const f = fixture(); f.state.afterLock = () => { f.state.now = new Date(f.scope.expiresAtUnix * 1000); };
    await assert.rejects(() => f.service.slots(f.scope, f.input), /embed_session_token_expired/); assert.equal(f.state.writes, 0);
  });
  await t.test("foreign professional/product identifiers cannot reveal labels or mutate a cart", async () => {
    for (const change of [{ professionalId: "foreign" }, { productId: "foreign" }]) {
      const f = fixture(); await assert.rejects(() => f.service.slots(f.scope, { ...f.input, ...change }), /professional_service_not_found/);
      assert.equal(f.state.writes, 0); assert.equal(f.state.cart, undefined);
    }
  });
  await t.test("inactive or unpublished professionals and inactive services remain unavailable", async () => {
    for (const field of ["isPublished", "isActive"] as const) {
      const f = fixture(); f.professional[field] = false;
      assert.deepEqual((await f.service.professionals(f.scope, { productId: "product", variantId: "variant" })).professionals, []);
      await assert.rejects(() => f.service.slots(f.scope, f.input), /professional_service_not_available/); assert.equal(f.state.writes, 0);
    }
    const f = fixture(); f.product.isActive = false;
    await assert.rejects(() => f.service.slots(f.scope, f.input), /professional_service_not_available/); assert.equal(f.state.writes, 0);
  });
  await t.test("product businesses and admissions-disabled service businesses cannot publish reservable capacity", async () => {
    const f = fixture(); f.tx.merchant.findUnique = async () => ({ businessMode: "products", businessModeSelectedAt: f.state.now, businessModeNeedsReview: false });
    await assert.rejects(() => f.service.slots(f.scope, f.input), /service_booking_products_mode/);
    const g = fixture(); g.policy.admissionsEnabled = false;
    await assert.rejects(() => g.service.slots(g.scope, g.input), /service_booking_admissions_disabled/);
    assert.equal(f.state.writes + g.state.writes, 0);
  });
  await t.test("legacy reservations without classified capacity block discovery rather than fabricating free slots", async () => {
    const f = fixture(); f.tx.serviceReservation.findFirst = async () => ({ id: "private-legacy" });
    await assert.rejects(() => f.service.slots(f.scope, f.input), /service_legacy_classification_required/); assert.equal(f.state.writes, 0);
  });
  await t.test("canonical availability bounds reject an excessive date range", async () => {
    const f = fixture(); await assert.rejects(() => f.service.dates(f.scope, { ...f.input, fromDate: "2035-02-01", toDate: "2035-03-05" }), /invalid_availability_window/);
    assert.equal(f.state.writes, 0);
  });
});
