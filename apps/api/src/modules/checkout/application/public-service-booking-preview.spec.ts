import assert from "node:assert/strict";
import { test } from "node:test";
import { PublicServiceBookingReader } from "./public-service-booking-reader.js";

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

test("public service selection preview", async t => {
  await t.test("an exact current public slot produces only published review facts, never private cart fingerprints", async () => {
    const f = fixture(), selection = (await f.service.slots(f.scope, f.input)).selections[0]!;
    const review = await f.service.preview(f.scope, { selection });
    assert.deepEqual(review, { selection, service: { name: f.product.name }, professional: { name: f.professional.publicName },
      policy: { version: f.policy.version, holdEnabled: false, holdMinutes: null, paymentMode: "at_attendance" } });
    assert.equal(/fingerprint|globalUser|session|cart|email|phone|privateSecret/.test(JSON.stringify(review)), false);
    assert.equal(f.state.writes, 0);
  });
  await t.test("forged price, versions, slot ID, merchant tuple and newly occupied slots cannot produce a review", async () => {
    for (const patch of [{ priceInCents: 1 }, { professionalVersion: 1 }, { policyVersion: 1 }, { slotId: "forged" }, { productId: "foreign" }]) {
      const f = fixture(), selection = (await f.service.slots(f.scope, f.input)).selections[0]!;
      await assert.rejects(f.service.preview(f.scope, { selection: { ...selection, ...patch } }), /service_selection_stale|professional_service_not_found/);
      assert.equal(f.state.writes, 0);
    }
    const f = fixture(), selection = (await f.service.slots(f.scope, f.input)).selections[0]!;
    f.state.appointments = [{ startsAt: new Date(selection.startsAt), endsAt: new Date(selection.endsAt) }];
    await assert.rejects(f.service.preview(f.scope, { selection }), /service_slot_unavailable/); assert.equal(f.state.writes, 0);
  });
  await t.test("public review respects every live hold, publication, and time after waiting on a lock", async () => {
    const f = fixture(true), selection = (await f.service.slots(f.scope, f.input)).selections[0]!;
    f.state.active = [{ owner: "someone", slots: [{ resourceId: "professional:" + selection.professionalId,
      slotId: selection.slotId, startsAt: selection.startsAt, endsAt: selection.endsAt }] }];
    await assert.rejects(f.service.preview(f.scope, { selection }), /service_slot_unavailable/);
    const g = fixture(), chosen = (await g.service.slots(g.scope, g.input)).selections[0]!;
    g.professional.isPublished = false;
    await assert.rejects(g.service.preview(g.scope, { selection: chosen }), /professional_service_not_available/);
    const h = fixture(), picked = (await h.service.slots(h.scope, h.input)).selections[0]!;
    h.state.afterLock = () => { h.state.now = new Date(h.scope.expiresAtUnix * 1000); };
    await assert.rejects(h.service.preview(h.scope, { selection: picked }), /embed_session_token_expired/);
    assert.equal(f.state.writes + g.state.writes + h.state.writes, 0);
  });
});
