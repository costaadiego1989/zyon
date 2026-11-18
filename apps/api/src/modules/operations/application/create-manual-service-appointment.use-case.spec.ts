// T31 criterion components. Preserves all12 prepared cases; first runtime is pending.
import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { slotFingerprint, withOriginalSlotLeaseProof } from "../../../shared/bookings/redis-service-slots.js";
import type { Prisma, PrismaClient } from "@prisma/client";
import type { ProfessionalLeaseStore } from "../../../shared/bookings/professional-service-lease.js";
import { getProfessionalAvailability } from "../../catalog/application/get-professional-availability.js";
import { admitServiceAppointment } from "../../../shared/bookings/service-appointment-admission.service.js";
import { CreateManualServiceAppointmentUseCase, createManualServiceAppointmentWithin,
  type ManualServiceAppointmentCommand } from "./create-manual-service-appointment.use-case.js";

const actor = { merchantId: "services", userId: "operator", role: "owner" };
const initialNow = new Date("2030-01-01T09:00:00Z");
const input = (): ManualServiceAppointmentCommand => ({ commandId: "manual-first", professionalId: "professional",
  productId: "consultation", variantId: "variant", expectedProfessionalVersion: 3, expectedPolicyVersion: 2,
  startsAt: "2030-01-02T14:00:00Z", customer: { kind: "contact", name: "Synthetic buyer", email: "buyer@example.test" },
  explicitOneOff: { reason: "Private operator note" } });

// Storage delegates invoke actual T22/T23/T26/T27/T30 functions. Rollback here
// models the caller-owned boundary; it is explicitly not SQL isolation proof.
function fixture(paymentMode: "online" | "at_attendance" = "at_attendance", holdEnabled = false) {
  let state: any = {
    merchant: { businessMode: "services", businessModeSelectedAt: initialNow, businessModeNeedsReview: false },
    policy: { admissionsEnabled: true, configuredAt: initialNow, version: 2, paymentMode,
      holdEnabled, holdMinutes: holdEnabled ? 4 : null },
    professional: { id: "professional", merchantId: "services", version: 3, timeZone: "UTC", isActive: true, isPublished: true },
    price: { basePriceInCents: 5000, currency: "BRL" },
    appointments: [], exceptions: [], audits: [], events: [], payments: [],
    customers: [{ merchantId: "services", sessionId: "known-session", globalUserId: "known-buyer",
      customer: { fullName: "Known buyer", phone: "+5521999990000" } }],
  };
  let currentNow = initialNow, failure = "", locks = 0, acquireCalls = 0, assertCalls = 0;
  let onAcquire: (() => void) | undefined;
  const held: Array<{ merchantId: string; owner: string; slots: unknown; ttlMs: number }> = [];
  const matches = (row: any, where: any) => (!where.id || row.id === where.id)
    && (!where.merchantId || row.merchantId === where.merchantId)
    && (!where.professionalId || row.professionalId === where.professionalId)
    && (!where.operationalStatus?.in || where.operationalStatus.in.includes(row.operationalStatus))
    && (!where.startsAt?.lt || row.startsAt < where.startsAt.lt)
    && (!where.endsAt?.gt || row.endsAt > where.endsAt.gt);
  const decorated = (row: any) => row ? { ...row, payments: state.payments.filter((p: any) => p.appointmentId === row.id) } : null;
  const forbidden = async () => assert.fail("manual command must not create PSP, order or physical-stock effects");
  const store: ProfessionalLeaseStore = {
    acquire: async (merchantId, owner, slots, ttlMs = 0) => { acquireCalls++; held.push({ merchantId, owner, slots, ttlMs });
      const expiresAt = new Date(currentNow.getTime() + ttlMs).toISOString();
      const result = withOriginalSlotLeaseProof({ expiresAt, slots }, { merchantId,
        ownerHash: createHash("sha256").update(owner).digest("hex"), generation: "00000000-0000-4000-8000-000000000001",
        fingerprint: slotFingerprint(slots), selectionFingerprint: slotFingerprint(slots), expiresAt, slots });
      onAcquire?.(); return result; },
    assertActive: async (merchantId, owner, slots) => { assertCalls++;
      if (failure === "lease") throw new Error("service_hold_required");
      assert.equal(held.at(-1)?.merchantId, merchantId); assert.equal(held.at(-1)?.owner, owner);
      assert.deepEqual(held.at(-1)?.slots, slots); return { merchantId, ownerHash: createHash("sha256").update(owner).digest("hex"),
        generation: "00000000-0000-4000-8000-000000000001", fingerprint: slotFingerprint(slots), selectionFingerprint: slotFingerprint(slots),
        expiresAt: new Date(currentNow.getTime() + (held.at(-1)?.ttlMs ?? 0)).toISOString(), slots }; },
    get: async () => undefined,
    release: async () => {},
  };
  const tx = {
    $queryRaw: async (sql: TemplateStringsArray | Prisma.Sql, ...values: unknown[]) => { locks++;
      const strings = Array.isArray(sql) ? sql : (sql as Prisma.Sql).strings;
      const parameters = Array.isArray(sql) ? values : (sql as Prisma.Sql).values;
      if (strings.join(" ").includes("FROM appointment_audits")) return state.audits.filter((row: any) => row.merchantId === parameters[0]
        && row.after?.privateLease?.generation === parameters[1] && row.after?.privateLease?.targetKey === parameters[2]);
      return [{ id: "resource" }]; },
    merchant: { findUnique: async ({ where }: any) => where.id === actor.merchantId ? state.merchant : null },
    serviceBusinessPolicy: { findUnique: async ({ where }: any) => where.merchantId === actor.merchantId ? state.policy : null },
    serviceReservation: { findFirst: async () => null, count: async () => 0 },
    product: { count: async () => 0 },
    serviceProfessional: {
      findFirst: async ({ where }: any) => where.id === state.professional.id && where.merchantId === actor.merchantId ? state.professional : null,
      updateMany: async ({ where }: any) => {
        if (where.version !== state.professional.version || where.merchantId !== actor.merchantId) return { count: 0 };
        state.professional.version++; return { count: 1 }; },
    },
    professionalService: { findFirst: async ({ where, include }: any) => {
      if (where.merchantId !== actor.merchantId || where.professionalId !== "professional" || where.productId !== "consultation") return null;
      const variant = { id: "variant", productId: "consultation", isActive: true, price: state.price };
      return { id: "canonical-link", merchantId: actor.merchantId, professionalId: "professional", productId: "consultation", isActive: true,
        professional: state.professional, product: { id: "consultation", merchantId: actor.merchantId, type: "service", isActive: true,
          deletedAt: null, categoryId: null, category: null, metadata: { serviceSchedule: { timeZone: "UTC", durationMinutes: 30, slots: [] } },
          variants: include.product.include.variants.where.id === "variant" ? [variant] : [] } }; } },
    productVariant: { findFirst: async ({ where }: any) => where.id === "variant" && where.productId === "consultation"
      ? { id: "variant", productId: "consultation", isActive: true, price: state.price,
        product: { id: "consultation", merchantId: actor.merchantId, type: "service", isActive: true, deletedAt: null } } : null },
    professionalAvailability: { findMany: async () => Array.from({ length: 7 }, (_, weekday) => ({ weekday, startMinute: 600,
      endMinute: 660, timeZone: "UTC", validFrom: null, validUntil: null })) },
    availabilityException: {
      findFirst: async ({ where }: any) => state.exceptions.find((row: any) => matches(row, where)
        && (!where.kind || row.kind === where.kind) && (!where.isActive || row.isActive)) ?? null,
      findMany: async () => state.exceptions.filter((row: any) => row.isActive),
      create: async ({ data }: any) => { const row = { ...data, id: "exception-" + (state.exceptions.length + 1), version: 1 };
        state.exceptions.push(row); return row; },
    },
    checkoutSession: { findFirst: async ({ where }: any) => state.customers.find((row: any) => row.merchantId === where.merchantId
      && row.globalUserId === where.globalUserId) ?? null },
    serviceAppointment: {
      findUnique: async ({ where }: any) => state.appointments.find((row: any) => row.merchantId === where.merchantId_idempotencyKey.merchantId
        && row.idempotencyKey === where.merchantId_idempotencyKey.idempotencyKey) ?? null,
      findFirst: async ({ where }: any) => decorated(state.appointments.find((row: any) => matches(row, where)
        && (!where.origin || row.origin === where.origin))),
      findMany: async ({ where }: any) => state.appointments.filter((row: any) => matches(row, where)),
      create: async ({ data }: any) => { const row = { ...data, id: "appointment-" + (state.appointments.length + 1), version: 1,
        availabilityExceptionId: null }; state.appointments.push(row); return row; },
      update: async ({ where, data }: any) => { const row = state.appointments.find((value: any) => matches(value, where));
        assert.ok(row); Object.assign(row, data); return decorated(row); },
    },
    appointmentAudit: {
      findUnique: async ({ where }: any) => state.audits.find((row: any) => row.merchantId === where.merchantId_commandId.merchantId
        && row.commandId === where.merchantId_commandId.commandId) ?? null,
      create: async ({ data }: any) => { if (failure === "capture_unique") throw Object.assign(new Error("synthetic_capture_unique"), { code: "P2002" });
        state.audits.push(data); return data; },
      update: async ({ where, data }: any) => { if (failure === "receipt") throw new Error("synthetic_manual_receipt_failure");
        const row = state.audits.find((value: any) => value.merchantId === where.merchantId_commandId.merchantId
          && value.commandId === where.merchantId_commandId.commandId); assert.ok(row); Object.assign(row, data); return row; },
    },
    appointmentPayment: {
      findUnique: async ({ where }: any) => state.payments.find((row: any) => row.merchantId === where.merchantId_idempotencyKey.merchantId
        && row.idempotencyKey === where.merchantId_idempotencyKey.idempotencyKey) ?? null,
      create: async ({ data }: any) => { if (failure === "balance") throw new Error("synthetic_manual_balance_failure");
        const row = { ...data, id: "payment-" + (state.payments.length + 1) }; state.payments.push(row); return row; },
    },
    outboxMessage: { create: async ({ data }: any) => { if (failure === "outbox") throw new Error("synthetic_manual_outbox_failure");
      state.events.push(data); return data; } },
    paymentIntent: { create: forbidden }, completedOrder: { create: forbidden }, inventoryMovement: { create: forbidden },
    productStock: { update: forbidden, updateMany: forbidden },
  } as unknown as Prisma.TransactionClient;
  const prisma = { $transaction: async (work: (tx: Prisma.TransactionClient) => Promise<unknown>) => {
    const before = structuredClone(state); try { return await work(tx); } catch (error) { state = before; throw error; }
  } } as unknown as PrismaClient;
  const context = { clock: () => { assert.ok(locks >= 2, "decision/preparation must follow merchant and professional locks");
    return new Date(currentNow); }, store: () => { assert.equal(state.policy.holdEnabled, true); return store; } };
  return { tx, prisma, get state() { return state; }, get acquired() { return acquireCalls; }, get asserted() { return assertCalls; }, held,
    advance: (now: Date) => { currentNow = now; }, acquireThen: (work: () => void) => { onAcquire = work; },
    fail: (stage: string) => { failure = stage; },
    run: (value = input(), principal = actor) => new CreateManualServiceAppointmentUseCase(prisma).execute(principal, value, context),
  };
}

test("T31", async t => {
  await t.test("explicit one-off and local appointment share canonical time/price/version and unpaid balance", async () => {
    const f = fixture(), result = await f.run();
    assert.equal(result.professionalVersion, 4); assert.equal(f.state.exceptions.length, 1);
    assert.equal(result.appointment.availabilityExceptionId, f.state.exceptions[0].id);
    assert.equal(result.appointment.startsAt.toISOString(), "2030-01-02T14:00:00.000Z");
    assert.equal(result.appointment.endsAt.toISOString(), "2030-01-02T14:30:00.000Z");
    assert.equal(result.appointment.timeZone, "UTC"); assert.equal(result.appointment.priceInCents, 5000);
    assert.equal(result.appointment.currency, "BRL"); assert.equal(result.appointment.operationalStatus, "scheduled");
    assert.deepEqual(result.appointment.customerSnapshot, { name: "Synthetic buyer", email: "buyer@example.test" });
    assert.equal(f.state.payments[0].amountCents, 5000); assert.equal(f.state.payments[0].status, "pending");
    assert.equal(f.state.audits.length, 1); assert.equal(f.state.events.length, 1); assert.equal(f.acquired, 0);
    assert.equal(JSON.stringify(f.state.events).includes("buyer@example.test"), false);
  });
  await t.test("all four existing hold/payment modes keep canonical local or online-pending semantics", async () => {
    for (const mode of ["at_attendance", "online"] as const) for (const hold of [false, true]) {
      const f = fixture(mode, hold), result = await f.run();
      assert.equal(result.appointment.operationalStatus, mode === "online" ? "pending" : "scheduled");
      assert.equal(result.appointment.confirmedAt === null, mode === "online");
      assert.equal(f.state.payments.length, mode === "online" ? 0 : 1);
      assert.equal(f.acquired, hold ? 1 : 0); assert.equal(f.asserted, hold && mode === "at_attendance" ? 1 : 0);
      if (hold) { assert.equal(f.held[0].merchantId, actor.merchantId); assert.equal(f.held[0].ttlMs, 240_000);
        assert.match(f.held[0].owner, /^[a-f0-9]{64}$/); }
      assert.equal(f.state.events[0].eventType, "service.appointment." + result.appointment.operationalStatus);
      if (mode === "online") {
        const available = await getProfessionalAvailability(f.tx, { merchantId: actor.merchantId, professionalId: "professional",
          productId: "consultation", variantId: "variant", fromDate: "2030-01-02", toDate: "2030-01-02",
          expectedVersion: result.professionalVersion, now: initialNow });
        assert.equal(available.slots.some(slot => slot.startsAt === "2030-01-02T14:00:00.000Z"), true);
      }
    }
  });
  await t.test("known customer belongs to the current merchant and arbitrary body identity/price is refused", async () => {
    const f = fixture(), request = { ...input(), customer: { kind: "known" as const, customerId: "known-buyer" } };
    const result = await f.run(request); assert.equal(result.appointment.buyerGlobalUserId, "known-buyer");
    assert.deepEqual(result.appointment.customerSnapshot, { name: "Known buyer", phone: "+5521999990000" });
    const foreign = fixture(); foreign.state.customers[0].merchantId = "foreign";
    await assert.rejects(foreign.run(request), /service_manual_customer_not_found/);
    assert.equal(foreign.state.exceptions.length, 0); assert.equal(foreign.state.appointments.length, 0);
    for (const extra of [{ merchantId: "foreign" }, { actorId: "forged" }, { priceInCents: 1 }, { timeZone: "Pacific/Tahiti" }])
      await assert.rejects(foreign.run({ ...input(), ...extra }), /service_manual_command_invalid/);
  });
  await t.test("operator role and tenant/canonical professional-service-variant tuple are mandatory", async () => {
    const f = fixture(); await assert.rejects(f.run(input(), { ...actor, role: "staff" }), /service_operator_required/);
    for (const change of [{ professionalId: "foreign" }, { productId: "foreign" }, { variantId: "foreign" }]) {
      const other = fixture(); await assert.rejects(other.run({ ...input(), ...change }), /professional_service_not_found/);
      assert.equal(other.state.exceptions.length, 0); assert.equal(other.state.appointments.length, 0);
    }
    f.state.merchant.businessMode = "products"; await assert.rejects(f.run(), /services_mode_required/);
  });
  await t.test("outside the grid requires an explicit one-off and still refuses blocks or confirmed capacity", async () => {
    const f = fixture(); await assert.rejects(f.run({ ...input(), explicitOneOff: undefined }), /service_slot_unavailable/);
    assert.equal(f.state.exceptions.length, 0);
    for (const occupied of ["block", "appointment"]) {
      const g = fixture(); const interval = { merchantId: actor.merchantId, professionalId: "professional",
        startsAt: new Date("2030-01-02T14:00:00Z"), endsAt: new Date("2030-01-02T14:30:00Z") };
      if (occupied === "block") g.state.exceptions.push({ ...interval, id: "blocked", kind: "block", isActive: true });
      else g.state.appointments.push({ ...interval, id: "occupied", operationalStatus: "scheduled" });
      await assert.rejects(g.run(), occupied === "block" ? /availability_block_conflict/ : /availability_appointment_conflict/);
      assert.equal(g.state.professional.version, 3);
    }
    const confirmed = fixture(); await confirmed.run();
    await assert.rejects(confirmed.run({ ...input(), commandId: "second", expectedProfessionalVersion: 4 }), /availability_appointment_conflict/);
    assert.equal(confirmed.state.appointments.length, 1); assert.equal(confirmed.state.exceptions.length, 1);
  });
  await t.test("regular manual and buyer commands use the same canonical confirmed capacity", async () => {
    const f = fixture(), request = { ...input(), startsAt: "2030-01-02T10:00:00Z", explicitOneOff: undefined };
    const result = await f.run(request); assert.equal(result.professionalVersion, 3); assert.equal(f.state.exceptions.length, 0);
    await assert.rejects(f.prisma.$transaction(tx => admitServiceAppointment(tx, {
      merchantId: actor.merchantId, professionalId: "professional", productId: "consultation", variantId: "variant",
      professionalVersion: 3, policyVersion: 2, date: "2030-01-02", startsAt: "2030-01-02T10:00:00.000Z",
      endsAt: "2030-01-02T10:30:00.000Z", priceInCents: 5000, currency: "BRL",
      customer: { name: "Independent buyer", phone: "+5521999990000" }, buyerGlobalUserId: "buyer",
      origin: "storefront", actorId: "buyer", idempotencyKey: "buyer-competes", confirmation: { kind: "at_attendance" },
    }, { clock: () => initialNow })), /service_slot_unavailable/);
    assert.equal(f.state.appointments.length, 1); assert.equal(f.state.payments.length, 1);
  });
  await t.test("closed or changed policy, stale professional and insufficient identity refuse the composite command", async () => {
    for (const scenario of ["closed", "policy", "professional", "contact", "email"]) {
      const f = fixture(), request = input();
      if (scenario === "closed") f.state.policy.admissionsEnabled = false;
      if (scenario === "policy") request.expectedPolicyVersion = 99;
      if (scenario === "professional") request.expectedProfessionalVersion = 99;
      if (scenario === "contact") request.customer = { kind: "contact", name: "Buyer" };
      if (scenario === "email") request.customer = { kind: "contact", name: "Buyer", email: "not-an-email" };
      await assert.rejects(f.run(request), /service_booking_admissions_disabled|service_policy_changed|service_selection_stale|service_appointment_invalid_/);
      assert.equal(f.state.exceptions.length, 0); assert.equal(f.state.professional.version, 3);
      assert.equal(f.state.appointments.length, 0); assert.equal(f.state.audits.length, 0); assert.equal(f.state.events.length, 0);
    }
  });
  await t.test("replay preserves one-off, immutable commercial snapshot and later local receipt under closed policy", async () => {
    const f = fixture(); const first = await f.run();
    f.state.policy.admissionsEnabled = false; f.state.policy.version = 99; f.state.professional.isActive = false;
    f.state.price.basePriceInCents = 9900; f.state.payments[0].status = "approved"; // synthetic later operator state
    const replay = await f.run(); assert.equal(replay.replayed, true); assert.equal(replay.appointment.id, first.appointment.id);
    assert.equal(replay.appointment.priceInCents, 5000); assert.equal(replay.appointment.payments[0].status, "approved");
    assert.equal(f.state.professional.version, 4); assert.equal(f.state.exceptions.length, 1);
    assert.equal(f.state.appointments.length, 1); assert.equal(f.state.audits.length, 1); assert.equal(f.state.events.length, 1);
  });
  await t.test("a changed original command or actor cannot reuse a previous receipt", async () => {
    const f = fixture(); await f.run(); const before = structuredClone(f.state);
    await assert.rejects(f.run({ ...input(), startsAt: "2030-01-02T15:00:00Z" }), /service_appointment_idempotency_conflict/);
    await assert.rejects(f.run(input(), { ...actor, userId: "another-operator", role: "admin" }), /service_appointment_idempotency_conflict/);
    assert.deepEqual(f.state, before);
  });
  await t.test("balance, outbox, receipt or lease failure rolls the entire modeled SQL command back", async () => {
    for (const stage of ["balance", "outbox", "receipt", "lease"]) {
      const f = fixture("at_attendance", stage === "lease"), before = structuredClone(f.state); f.fail(stage);
      await assert.rejects(f.run(), /synthetic_manual_|service_hold_required/); assert.deepEqual(f.state, before);
    }
  });
  await t.test("final fresh clock after lease preparation refuses crossing start and timestamps durable local effects once", async () => {
    const f = fixture("at_attendance", true); f.acquireThen(() => f.advance(new Date(input().startsAt)));
    await assert.rejects(f.run(), /service_slot_unavailable/); assert.equal(f.state.exceptions.length, 0);
    assert.equal(f.state.appointments.length, 0); assert.equal(f.state.professional.version, 3);
    const g = fixture("at_attendance", true), fresh = new Date("2030-01-01T09:01:00Z");
    g.acquireThen(() => g.advance(fresh)); const result = await g.run();
    assert.equal(result.appointment.confirmedAt?.toISOString(), fresh.toISOString());
    assert.equal(g.state.payments[0].createdAt.toISOString(), fresh.toISOString());
    assert.equal(g.state.audits[0].occurredAt.toISOString(), fresh.toISOString());
    assert.equal(g.state.events[0].occurredAt.toISOString(), fresh.toISOString());
  });
  await t.test("the original customer and explicit one-off request are snapshotted before any lock await", async () => {
    const f = fixture(), value = input(), pending = f.run(value);
    if (value.customer.kind !== "contact") assert.fail("contact fixture required");
    value.customer.name = "MUTATED-AFTER-CALL"; value.explicitOneOff!.reason = "MUTATED-REASON";
    const result = await pending; assert.deepEqual(result.appointment.customerSnapshot, { name: "Synthetic buyer", email: "buyer@example.test" });
    assert.equal(f.state.exceptions[0].reason, "Private operator note");
  });
  await t.test("root Prisma input is refused before opening a nested or partial transaction", async () => {
    const f = fixture(), before = structuredClone(f.state);
    await assert.rejects(createManualServiceAppointmentWithin(f.prisma as unknown as Prisma.TransactionClient, actor, input()),
      /service_manual_transaction_required/); assert.deepEqual(f.state, before);
  });
});


test("T33 pending manual retains original acquired proof without adding a confirmation assertion", async () => {
  const f = fixture("online", true), result = await f.run();
  const capture = f.state.audits[0].after.privateLease;
  assert.equal(result.appointment.operationalStatus, "pending");
  assert.equal(f.acquired, 1); assert.equal(f.asserted, 0);
  assert.equal(capture.kind, "owned"); assert.equal(capture.generation, "00000000-0000-4000-8000-000000000001");
  assert.equal(capture.ownerHash, createHash("sha256").update(f.held[0].owner).digest("hex"));
  assert.equal(capture.target.resourceId, "professional:professional");
  assert.equal(capture.target.startsAt, result.appointment.startsAt.toISOString());
  assert.equal(f.state.audits[0].action, "manual_create");
  assert.equal(JSON.stringify(f.state.events).includes(capture.generation), false);
});

test("T33 owned capture SQL uniqueness maps to conflict and rolls back the pending attempt", async () => {
  const f = fixture("online", true), before = structuredClone(f.state); f.fail("capture_unique");
  await assert.rejects(f.run(), /service_hold_generation_consumed/); assert.deepEqual(f.state, before);
});
