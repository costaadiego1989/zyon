import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import type { Prisma, PrismaClient } from "@prisma/client";
import { captureAppointmentLease } from "../../../shared/bookings/appointment-lease-proof.js";
import { professionalHoldRequests, professionalSlotId } from "../../../shared/bookings/service-checkout-selection.js";
import { slotFingerprint, withOriginalSlotLeaseProof, type SlotRequest } from "../../../shared/bookings/redis-service-slots.js";
import { RescheduleServiceAppointmentUseCase } from "./reschedule-service-appointment.use-case.js";

const actor = { merchantId: "m", userId: "operator", role: "owner" }, initialNow = new Date("2030-01-01T09:00Z");
function fixture(hold = false) {
  const oldSelection = { productId: "service", variantId: "variant", professionalId: "p", professionalVersion: 3, policyVersion: 2,
    date: "2030-01-02", startsAt: "2030-01-02T10:00:00.000Z", endsAt: "2030-01-02T10:20:00.000Z", timeZone: "UTC",
    durationMinutes: 20, priceInCents: 5000, currency: "BRL", slotId: "" };
  oldSelection.slotId = professionalSlotId("m", oldSelection); const source = professionalHoldRequests([oldSelection])[0];
  const proof = (owner: string, slots: SlotRequest[], generation: string) => ({ merchantId: "m", ownerHash: createHash("sha256").update(owner).digest("hex"),
    generation, fingerprint: slotFingerprint(slots), selectionFingerprint: slotFingerprint(slots), expiresAt: "2030-01-01T09:07:00.000Z", slots });
  const old = captureAppointmentLease("m", "original", proof("original", [source], "00000000-0000-4000-8000-000000000001"), source);
  let state: any = { merchant: { id: "m", name: "Synthetic business", businessMode: "services", businessModeSelectedAt: initialNow,
      businessModeNeedsReview: false, storeSettings: { policies: { general: "Human-reviewed changes" } }, updatedAt: initialNow },
    policy: { version: 2, admissionsEnabled: true, configuredAt: initialNow, paymentMode: "at_attendance", holdEnabled: hold, holdMinutes: hold ? 7 : null },
    professional: { id: "p", merchantId: "m", version: 3, isActive: true, isPublished: true, timeZone: "UTC" }, duration: 20,
    price: { basePriceInCents: 5000, currency: "BRL" },
    appointment: { id: "a", merchantId: "m", professionalId: "p", productId: "service", variantId: "variant", buyerGlobalUserId: null,
      customerSnapshot: { name: "Synthetic contact", email: "contact@example.test" }, origin: "manual", operationalStatus: "scheduled", version: 1,
      startsAt: new Date(source.startsAt), endsAt: new Date(source.endsAt), timeZone: "UTC", durationMinutes: 20, priceInCents: 5000, currency: "BRL",
      policyVersion: 2, policySnapshot: { paymentMode: "at_attendance", holdEnabled: hold, holdMinutes: hold ? 7 : null },
      availabilityExceptionId: null, requestFingerprint: "original-admission", orderId: null },
    audits: [{ id: "original", merchantId: "m", appointmentId: "a", commandId: "manual-original", version: 1, action: "manual_create",
      after: { ...(hold ? { privateLease: old } : {}) } }], payments: [{ id: "balance", merchantId: "m", appointmentId: "a", version: 1,
      mode: "at_attendance", status: "pending", amountCents: 5000, currency: "BRL", receivedAt: null, paymentIntentId: null, providerPaymentId: null }],
    events: [], others: [] };
  let now = initialNow, failure = "", unknownCommit = false, acquisitions = 0, checks = 0, intake: any = null;
  let cleanupGate: Promise<void> | undefined, resumeCleanup: (() => void) | undefined;
  let enterCleanup!: () => void; const cleanupEntered = new Promise<void>(resolve => { enterCleanup = resolve; });
  const activeDestinations = new Set<string>();
  const released: any[] = []; let nextProof: ReturnType<typeof proof> | undefined;
  const acquire = async (_m: string, owner: string, slots: SlotRequest[]) => { acquisitions++;
    nextProof = proof(owner, slots, "00000000-0000-4000-8000-" + String(acquisitions + 1).padStart(12, "0")); activeDestinations.add(nextProof.generation);
    return withOriginalSlotLeaseProof({ expiresAt: nextProof.expiresAt, slots }, nextProof); };
  const store = { acquire, acquireForAppointmentReschedule: async (m: string, owner: string, slots: SlotRequest[], _ttl: number, original: unknown) => {
    assert.deepEqual(original, old); return acquire(m, owner, slots); },
    assertActive: async () => { checks++; assert.ok(nextProof); if (failure === "clock-active") now = new Date(nextProof.slots[0].startsAt);
      return failure === "generation" ? { ...nextProof,
      generation: "00000000-0000-4000-8000-000000000003" } : nextProof; },
    releaseCaptured: async (_m: string, capture: any) => { released.push(capture); enterCleanup(); if (failure === "cleanup") throw Error("synthetic_cleanup_failure");
      if (cleanupGate) await cleanupGate; activeDestinations.delete(capture.generation); return { released: true }; },
    get: async () => assert.fail("never reconstruct a proof from public/current cart"), release: async () => assert.fail("never broad-release session") };
  const match = (row: any, where: any) => row && (!where.id || row.id === where.id) && (!where.merchantId || row.merchantId === where.merchantId)
    && (!where.version || row.version === where.version) && (!where.productId || row.productId === where.productId)
    && (!where.variantId || row.variantId === where.variantId) && (!where.professionalId || row.professionalId === where.professionalId)
    && (!where.operationalStatus || (typeof where.operationalStatus === "string" ? row.operationalStatus === where.operationalStatus : where.operationalStatus.in.includes(row.operationalStatus)));
  const forbidden = async () => assert.fail("reschedule never dispatches money/provider/stock effects");
  const tx = {
    $queryRaw: async (sql: TemplateStringsArray | Prisma.Sql, ...values: unknown[]) => {
      const strings = Array.isArray(sql) ? sql : (sql as Prisma.Sql).strings, params = Array.isArray(sql) ? values : (sql as Prisma.Sql).values;
      if (strings.join(" ").includes("FROM appointment_audits")) {
        if (failure === "clock-unused") { assert.ok(nextProof); now = new Date(nextProof.slots[0].startsAt); }
        return state.audits.filter((a: any) => a.merchantId === params[0]
          && a.after.privateLease?.generation === params[1] && a.after.privateLease?.targetKey === params[2]);
      }
      return [{ id: "resource" }]; },
    merchant: { findUnique: async ({ where }: any) => where.id === "m" ? state.merchant : null, findUniqueOrThrow: async () => state.merchant },
    merchantPolicy: { findUnique: async () => null }, product: { count: async () => 0 }, serviceBusinessPolicy: { findUnique: async () => state.policy },
    professionalService: { findFirst: async ({ where }: any) => where.merchantId === "m" && where.professionalId === "p" ? {
      id: "link", merchantId: "m", professionalId: "p", productId: "service", isActive: true, professional: state.professional,
      product: { id: "service", merchantId: "m", type: "service", isActive: true, deletedAt: null, categoryId: null, category: null,
        metadata: { serviceSchedule: { timeZone: "UTC", durationMinutes: state.duration, slots: [] } },
        variants: [{ id: "variant", productId: "service", isActive: true, price: state.price }] } } : null },
    professionalAvailability: { findMany: async () => Array.from({ length: 7 }, (_, weekday) => ({ weekday, startMinute: 600, endMinute: 720,
      timeZone: "UTC", validFrom: null, validUntil: null })) }, availabilityException: { findMany: async () => [] },
    serviceAppointment: { findFirst: async ({ where }: any) => match(state.appointment, where) ? structuredClone(state.appointment) : null,
      findFirstOrThrow: async () => structuredClone(state.appointment),
      findMany: async ({ where }: any) => [state.appointment, ...state.others].filter(a => match(a, { ...where, startsAt: undefined, endsAt: undefined }) && a.id !== where.NOT?.id),
      updateMany: async ({ where, data }: any) => { if (!match(state.appointment, where)) return { count: 0 };
        const { version, ...rest } = data; Object.assign(state.appointment, rest); state.appointment.version += version.increment; return { count: 1 }; } },
    appointmentPayment: { findMany: async () => structuredClone(state.payments), updateMany: async ({ where, data }: any) => {
      const row = state.payments.find((p: any) => match(p, where)); if (!row) return { count: 0 };
      const { version, ...rest } = data; Object.assign(row, rest); row.version += version.increment; return { count: 1 }; } },
    attendanceReceipt: { findFirst: async () => null, create: forbidden }, supportTicketMessage: { findFirst: async () => intake },
    serviceReservation: { updateMany: async () => ({ count: 0 }) },
    appointmentAudit: { findUnique: async ({ where }: any) => state.audits.find((a: any) => a.merchantId === where.merchantId_commandId.merchantId
      && a.commandId === where.merchantId_commandId.commandId) ?? null,
      findFirst: async () => state.audits.filter((a: any) => a.after.privateLease).sort((a: any, b: any) => b.version - a.version)[0] ?? null,
      create: async ({ data }: any) => { const row = { ...data, id: "audit-" + state.audits.length }; state.audits.push(row); return row; } },
    outboxMessage: { create: async ({ data }: any) => { if ((failure === "outbox" || failure === "cleanup") && data.producer === "service-booking-private") throw Error("synthetic_outbox_failure"); state.events.push(data); return data; } },
    paymentIntent: { create: forbidden, update: forbidden }, completedOrder: { create: forbidden, update: forbidden }, inventoryMovement: { create: forbidden },
  } as unknown as Prisma.TransactionClient;
  const prisma = { $transaction: async (work: (client: Prisma.TransactionClient) => Promise<unknown>) => {
    const before = structuredClone(state); let value;
    try { value = await work(tx); } catch (error) { state = before; throw error; }
    if (unknownCommit) { unknownCommit = false; throw Error("synthetic_commit_unknown"); } return value;
  } } as unknown as PrismaClient;
  const service = new RescheduleServiceAppointmentUseCase(prisma), context = { clock: () => new Date(now), store: () => {
    assert.equal(state.policy.holdEnabled || hold, true); return store; } };
  const preview = { appointmentId: "a", expectedVersion: 1, destination: { professionalId: "p", expectedProfessionalVersion: 3, startsAt: "2030-01-02T10:20:00Z" } };
  const command = async () => { const q = await service.preview(actor, preview, context); return { ...preview, commandId: "move",
    operatorRequestId: "human-request", policyHash: q.quote.policyHash, acceptedQuoteHash: q.quoteHash }; };
  return { service, context, preview, command, get state() { return state; }, old, source, released,
    get acquisitions() { return acquisitions; }, get checks() { return checks; },
    fail: (stage: string) => { failure = stage; }, commitUnknown: () => { unknownCommit = true; }, advance: (date: Date) => { now = date; },
    activeDestinations, cleanupEntered, intake: (value: unknown) => { intake = value; },
    delayCleanup: () => { cleanupGate = new Promise(resolve => { resumeCleanup = resolve; }); }, resumeCleanup: () => resumeCleanup!(),
    run: async (value: Awaited<ReturnType<typeof command>>, principal = actor) => service.execute(principal, value, context) };
}

test("T34 canonical state command and rollback boundaries", async t => {
  await t.test("hold-off writes explicit latest none and preserves original history and financial identity", async () => {
    const f = fixture(), before = structuredClone(f.state); await f.run(await f.command());
    assert.equal(f.state.appointment.id, "a"); assert.equal(f.state.appointment.version, 2); assert.equal(f.state.audits[1].after.privateLease.kind, "none");
    assert.equal(f.state.audits[1].before.startsAt, before.appointment.startsAt.toISOString()); assert.deepEqual(f.state.audits[0], before.audits[0]);
    assert.deepEqual(f.state.payments, before.payments); assert.equal(f.acquisitions, 0); assert.equal(f.released.length, 0);
  });
  await t.test("new owned binding and committed source pointer are persisted without precommit origin release", async () => {
    const f = fixture(true); await f.run(await f.command()); const after = f.state.audits[1].after;
    assert.equal(after.privateLease.kind, "owned"); assert.notEqual(after.privateLease.generation, f.old.generation);
    assert.equal(after.privateLease.target.startsAt, "2030-01-02T10:20:00.000Z"); assert.equal(after.privateLeaseCleanup.originalAuditId, "original");
    assert.equal(f.released.length, 0); assert.equal(f.acquisitions, 1); assert.equal(f.checks, 1);
    assert.deepEqual(f.state.events.find((e: any) => e.producer === "service-booking-private").payload,
      { originalAuditId: "original", appointmentId: "a", rescheduleVersion: 2 });
  });
  await t.test("actor body or stale original version cannot grant a move", async () => {
    const f = fixture(), command = await f.command(), before = structuredClone(f.state);
    await assert.rejects(f.run(command, { ...actor, role: "staff" }), /service_operator_required/);
    await assert.rejects(f.run({ ...command, expectedVersion: 2 }), /service_appointment_version_conflict/);
    await assert.rejects(f.run({ ...command, refund: true } as any), /service_reschedule_command_invalid/); assert.deepEqual(f.state, before);
  });
  await t.test("changed current quote requires new explicit acceptance", async () => {
    const f = fixture(), command = await f.command(); f.state.price.basePriceInCents = 6000; const before = structuredClone(f.state);
    await assert.rejects(f.run(command), /service_reschedule_quote_changed/); assert.deepEqual(f.state, before);
    await f.run(await f.command()); assert.equal(f.state.payments[0].amountCents, 6000); assert.equal(f.state.payments[0].receivedAt, null);
  });
  await t.test("received or online money cannot be rewritten by accepted new terms", async () => {
    for (const mode of ["online", "at_attendance"]) { const f = fixture(); f.state.payments[0].mode = mode; f.state.payments[0].status = "approved";
      f.state.payments[0].receivedAt = initialNow; f.state.price.basePriceInCents = 6000; const command = await f.command(), before = structuredClone(f.state);
      await assert.rejects(f.run(command), /service_reschedule_financial_review_required/); assert.deepEqual(f.state, before); }
  });
  await t.test("own exclusion permits changed duration but never removes another occupied appointment", async () => {
    const f = fixture(); f.state.duration = 30; f.preview.destination.startsAt = "2030-01-02T10:00:00Z"; await f.run(await f.command());
    assert.equal(f.state.appointment.endsAt.toISOString(), "2030-01-02T10:30:00.000Z");
    const other = fixture(); other.state.others.push({ ...other.state.appointment, id: "b", startsAt: new Date("2030-01-02T10:20Z"), endsAt: new Date("2030-01-02T10:40Z") });
    await assert.rejects(other.command(), /service_slot_unavailable/); assert.equal(other.state.appointment.version, 1);
  });
  await t.test("mismatched latest original binding is refused without fallback or acquired destination", async () => {
    const f = fixture(true), command = await f.command(); f.state.audits[0].after.privateLease.target.startsAt = "2030-01-03T10:00:00.000Z";
    const before = structuredClone(f.state); await assert.rejects(f.run(command), /service_appointment_lease_binding_mismatch/);
    assert.equal(f.acquisitions, 0); assert.deepEqual(f.state, before);
  });
  await t.test("a newer active destination generation cannot replace the original acquisition proof", async () => {
    const f = fixture(true), command = await f.command(); f.fail("generation"); const before = structuredClone(f.state);
    await assert.rejects(f.run(command), /service_reschedule_destination_lease_changed/); assert.deepEqual(f.state, before);
    assert.equal(f.released.length, 1); assert.equal(f.released[0].generation, "00000000-0000-4000-8000-000000000002");
  });
  await t.test("known callback rollback exact-releases only destination and retains original SQL receipt", async () => {
    const f = fixture(true), command = await f.command(), before = structuredClone(f.state); f.fail("outbox");
    await assert.rejects(f.run(command), /synthetic_outbox_failure/); assert.deepEqual(f.state, before);
    assert.equal(f.released.length, 1); assert.notEqual(f.released[0].generation, f.old.generation);
    assert.equal(f.released[0].target.startsAt, "2030-01-02T10:20:00.000Z");
  });
  await t.test("unknown commit outcome never releases a possibly committed destination and original replay stays once", async () => {
    const f = fixture(true), command = await f.command(); f.commitUnknown(); await assert.rejects(f.run(command), /synthetic_commit_unknown/);
    assert.equal(f.state.appointment.version, 2); assert.equal(f.released.length, 0);
    const replay = await f.run(command); assert.equal(replay.replayed, true); assert.equal(f.acquisitions, 1); assert.equal(f.state.audits.length, 2);
  });
  await t.test("failed exact rollback cleanup is an explicit error and never claims original or destination freed", async () => {
    const f = fixture(true), command = await f.command(), before = structuredClone(f.state); f.fail("cleanup");
    await assert.rejects(f.run(command), /service_reschedule_rollback_cleanup_failed/); assert.deepEqual(f.state, before);
    assert.equal(f.released.length, 1); assert.notEqual(f.released[0].generation, f.old.generation);
  });
  await t.test("manual operator remains separate from buyer intake and malformed optional IDs cannot pass XOR", async () => {
    const f = fixture(), command = await f.command();
    await assert.rejects(f.run({ ...command, operatorRequestId: undefined, requestMessageId: "missing-intake" }), /service_reschedule_request_not_found/);
    for (const bad of [null, 0, false, "", [], {}]) await assert.rejects(f.run({ ...command, requestMessageId: bad } as any), /service_reschedule_command_invalid/);
    assert.equal(f.state.appointment.buyerGlobalUserId, null); assert.equal(f.state.appointment.version, 1);
  });
  await t.test("delayed rollback compensation never removes a successful same-command retry generation", async () => {
    const f = fixture(true), command = await f.command(); f.fail("outbox"); f.delayCleanup();
    const rejected = assert.rejects(f.run(command), /synthetic_outbox_failure/);
    // Wait only for this controlled boundary; an earlier rejection fails here.
    await Promise.race([f.cleanupEntered, rejected.then(() => assert.fail("expected delayed cleanup boundary"))]);
    f.fail(""); const result = await f.run(command); assert.equal(result.appliedVersion, 2);
    const committed = f.state.audits[1].after.privateLease; assert.notEqual(committed.generation, f.released[0].generation);
    assert.notEqual(committed.ownerHash, f.released[0].ownerHash); f.resumeCleanup(); await rejected;
    assert.deepEqual([...f.activeDestinations], [committed.generation]); assert.equal(f.state.appointment.version, 2);
  });
  await t.test("held origin to policy-off writes latest none plus durable original pointer", async () => {
    const f = fixture(true); f.state.policy.holdEnabled = false; f.state.policy.holdMinutes = null; f.state.policy.version++;
    await f.run(await f.command()); const after = f.state.audits[1].after;
    assert.equal(after.privateLease.kind, "none"); assert.equal(after.privateLeaseCleanup.originalAuditId, "original");
    assert.equal(f.state.audits[0].after.privateLease.generation, f.old.generation); assert.equal(f.acquisitions, 0); assert.equal(f.released.length, 0);
  });
  await t.test("trusted schema-one buyer handoff binds exact tenant buyer appointment and booked policy", async () => {
    const f = fixture(); f.state.appointment.buyerGlobalUserId = "buyer";
    f.intake({ id: "intake", senderType: "buyer", ticket: { id: "ticket", merchantId: "m", buyerId: "buyer", source: "whatsapp" },
      metadata: { kind: "whatsapp_intake", schemaVersion: 1, appointmentId: "a", policyVersion: 2 } });
    const command = { ...await f.command(), operatorRequestId: undefined, requestMessageId: "intake" }; await f.run(command);
    assert.equal(f.state.audits[1].after.request.kind, "buyer_handoff_operator_acceptance"); assert.equal(f.state.audits[1].after.request.requestMessageId, "intake");
    assert.equal(f.state.appointment.buyerGlobalUserId, "buyer");
  });
  await t.test("wrong intake schema tenant buyer appointment or booked policy cannot authorize a move", async () => {
    for (const change of [{ metadata: { schemaVersion: 2 } }, { ticket: { merchantId: "foreign" } }, { ticket: { buyerId: "foreign" } },
      { metadata: { appointmentId: "other" } }, { metadata: { policyVersion: 1 } }]) {
      const f = fixture(); f.state.appointment.buyerGlobalUserId = "buyer";
      f.intake({ id: "intake", senderType: "buyer", ticket: { id: "ticket", merchantId: "m", buyerId: "buyer", source: "whatsapp", ...change.ticket },
        metadata: { kind: "whatsapp_intake", schemaVersion: 1, appointmentId: "a", policyVersion: 2, ...change.metadata } });
      const command = { ...await f.command(), operatorRequestId: undefined, requestMessageId: "intake" }, before = structuredClone(f.state);
      await assert.rejects(f.run(command), /service_reschedule_request_not_found/); assert.deepEqual(f.state, before);
    }
  });
  await t.test("crossing the destination start during either final IO rejects without moving the original or settling money", async () => {
    for (const stage of ["clock-active", "clock-unused"]) {
      const f = fixture(true), command = await f.command(), before = structuredClone(f.state); f.fail(stage);
      await assert.rejects(f.run(command), /service_slot_unavailable/);
      assert.deepEqual(f.state, before); assert.deepEqual(f.state.audits[0].after.privateLease, f.old);
      assert.equal(f.acquisitions, 1); assert.equal(f.released.length, 1); assert.equal(f.released[0].generation, "00000000-0000-4000-8000-000000000002");
      assert.notEqual(f.released[0].generation, f.old.generation); assert.equal(f.activeDestinations.size, 0);
      assert.equal(f.released[0].target.startsAt, "2030-01-02T10:20:00.000Z");
    }
  });
});
