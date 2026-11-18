// TEST FIRST, CACHE ONLY. No import/parse/test execution. Oracles derive from ATEND-07/KPI-06/BOOK-08 and existing action contracts.
import assert from "node:assert/strict";
import test from "node:test";
import type { Prisma, PrismaClient } from "@prisma/client";
import { TransitionServiceAppointmentUseCase, transitionServiceAppointmentWithin,
  type AttendanceTransitionCommand } from "./transition-service-appointment.use-case.js";

const actor = { merchantId: "services", userId: "operator", role: "owner" };
const startsAt = new Date("2030-01-02T10:00:00Z"), now = new Date("2030-01-02T10:15:00Z");
const command = (action: AttendanceTransitionCommand["action"] = "start_service"): AttendanceTransitionCommand => ({
  appointmentId: "appointment", commandId: "attendance-first", expectedVersion: 1, action,
});

// The fake tx models resulting records and rollback only; PostgreSQL locks/CAS
// contention/constraints and true atomicity still require the later native gate.
function fixture(status = "scheduled") {
  let state: any = {
    merchant: { businessMode: "services", businessModeSelectedAt: new Date("2029-01-01Z"), businessModeNeedsReview: false },
    appointment: { id: "appointment", merchantId: "services", professionalId: "professional", productId: "service", variantId: "variant",
      buyerGlobalUserId: "buyer", customerSnapshot: { name: "Synthetic private buyer", email: "private@example.test" },
      startsAt, endsAt: new Date("2030-01-02T10:30:00Z"), timeZone: "UTC", durationMinutes: 30,
      priceInCents: 5000, currency: "BRL", origin: "storefront", operationalStatus: status, version: 1,
      policyVersion: 2, policySnapshot: { paymentMode: "at_attendance", holdEnabled: false, holdMinutes: null },
      idempotencyKey: "original-admit", requestFingerprint: "original-admission-fingerprint", availabilityExceptionId: null,
      confirmedAt: status === "pending" ? null : new Date("2030-01-01T09:00:00Z"),
      startedAt: status === "in_service" ? new Date("2030-01-02T10:01:00Z") : null,
      completedAt: null, noShowAt: null, cancelledAt: null },
    payments: [{ id: "local-balance", status: "pending", amountCents: 5000, currency: "BRL", receivedAt: null }],
    audits: [], events: [],
  };
  let time = now, locks = 0, failure = "", forceCasZero = false;
  const financial = async () => assert.fail("attendance must neither query payment eligibility nor mutate financial/order/stock state");
  const matches = (where: any) => where.id === state.appointment.id && where.merchantId === state.appointment.merchantId;
  const tx = {
    $queryRaw: async () => { locks++; return [{ id: "resource" }]; },
    merchant: { findUnique: async ({ where }: any) => where.id === actor.merchantId ? state.merchant : null },
    product: { count: async () => 0 }, serviceReservation: { count: async () => 0, update: financial },
    serviceAppointment: {
      findFirst: async ({ where }: any) => matches(where) ? { ...state.appointment } : null,
      updateMany: async ({ where, data }: any) => {
        if (forceCasZero || !matches(where) || where.version !== state.appointment.version
          || where.operationalStatus !== state.appointment.operationalStatus) return { count: 0 };
        const { version, ...fields } = data; Object.assign(state.appointment, fields);
        state.appointment.version += version.increment; return { count: 1 }; },
    },
    appointmentAudit: {
      findUnique: async ({ where }: any) => state.audits.find((row: any) => row.merchantId === where.merchantId_commandId.merchantId
        && row.commandId === where.merchantId_commandId.commandId) ?? null,
      create: async ({ data }: any) => { if (failure === "audit") throw new Error("synthetic_attendance_audit_failure");
        state.audits.push(data); return data; },
    },
    outboxMessage: { create: async ({ data }: any) => { if (failure === "outbox") throw new Error("synthetic_attendance_outbox_failure");
      state.events.push(data); return data; } },
    appointmentPayment: { findMany: financial, findUnique: financial, update: financial, updateMany: financial, create: financial },
    paymentIntent: { findFirst: financial, update: financial, create: financial },
    completedOrder: { findFirst: financial, update: financial, create: financial },
    inventoryMovement: { create: financial }, productStock: { update: financial, updateMany: financial },
  } as unknown as Prisma.TransactionClient;
  const prisma = { $transaction: async (work: (tx: Prisma.TransactionClient) => Promise<unknown>) => {
    const before = structuredClone(state); try { return await work(tx); } catch (error) { state = before; throw error; }
  } } as unknown as PrismaClient;
  const context = { clock: () => { assert.ok(locks >= 3, "clock follows merchant/professional/appointment locks"); return new Date(time); } };
  return { tx, prisma, get state() { return state; }, advance: (value: Date) => { time = value; },
    fail: (stage: string) => { failure = stage; }, loseCas: () => { forceCasZero = true; },
    run: (input = command(), principal = actor) => new TransitionServiceAppointmentUseCase(prisma).execute(principal, input, context) };
}

test("T32 attendance draft", async t => {
  await t.test("all scheduled/pending/in-service/terminal action cells match the existing explicit state machine", async () => {
    const targets = new Map([["scheduled/start_service", "in_service"], ["scheduled/no_show", "no_show"], ["in_service/complete_service", "completed"]]);
    for (const state of ["pending", "scheduled", "in_service", "completed", "no_show", "cancelled"])
      for (const action of ["start_service", "complete_service", "no_show"] as const) {
        const f = fixture(state), expected = targets.get(state + "/" + action), before = structuredClone(f.state);
        if (!expected) { await assert.rejects(f.run(command(action)), /service_attendance_action_not_allowed/); assert.deepEqual(f.state, before); }
        else { const result = await f.run(command(action)); assert.equal(result.appointment.operationalStatus, expected);
          assert.equal(result.appointment.version, 2); assert.equal(f.state.audits.length, 1); assert.equal(f.state.events.length, 1); }
      }
  });
  await t.test("local pending balance permits explicit start/complete without settling or rewriting any finance", async () => {
    const f = fixture(), money = structuredClone(f.state.payments), snapshot = structuredClone(f.state.appointment);
    await f.run(); const completed = await f.run({ ...command("complete_service"), commandId: "attendance-complete", expectedVersion: 2 });
    assert.equal(completed.appointment.operationalStatus, "completed"); assert.deepEqual(f.state.payments, money);
    assert.equal(completed.appointment.priceInCents, snapshot.priceInCents); assert.equal(completed.appointment.currency, snapshot.currency);
    assert.deepEqual(completed.appointment.customerSnapshot, snapshot.customerSnapshot);
    assert.equal(completed.appointment.origin, "storefront"); assert.equal(f.state.audits[1].actorId, actor.userId);
  });
  await t.test("payment approval and elapsed schedule alone never infer presence, completion or absence", async () => {
    const f = fixture(); f.state.payments[0].status = "approved"; f.advance(new Date("2030-02-01T00:00:00Z"));
    assert.equal(f.state.appointment.operationalStatus, "scheduled"); assert.equal(f.state.audits.length, 0);
    await assert.rejects(f.run({ ...command(), action: "automatic" } as unknown as AttendanceTransitionCommand), /service_attendance_command_invalid/);
    assert.equal(f.state.appointment.completedAt, null); assert.equal(f.state.appointment.noShowAt, null);
    const pending = fixture("pending"); pending.state.payments[0].status = "approved";
    await assert.rejects(pending.run(), /service_attendance_action_not_allowed/); assert.equal(pending.state.appointment.confirmedAt, null);
  });
  await t.test("an explicit operator gesture is recorded without importing legacy Order proof or planned-start restrictions", async () => {
    for (const action of ["start_service", "no_show"] as const) {
      const f = fixture(); f.advance(new Date("2030-01-02T09:59:59Z"));
      const result = await f.run(command(action)); assert.equal(result.appointment.operationalStatus, action === "no_show" ? "no_show" : "in_service");
      assert.equal(f.state.audits.length, 1); assert.equal(f.state.events.length, 1);
    }
    const earlyCompletion = fixture("in_service"); earlyCompletion.advance(new Date("2030-01-02T10:02:00Z"));
    assert.equal((await earlyCompletion.run(command("complete_service"))).appointment.operationalStatus, "completed");
  });
  await t.test("expectedVersion and failed CAS cannot overwrite a different current appointment state", async () => {
    const stale = fixture(), before = structuredClone(stale.state);
    await assert.rejects(stale.run({ ...command(), expectedVersion: 99 }), /service_appointment_version_conflict/);
    assert.deepEqual(stale.state, before);
    const race = fixture(); race.loseCas(); await assert.rejects(race.run(), /service_appointment_version_conflict/);
    assert.equal(race.state.appointment.version, 1); assert.equal(race.state.audits.length, 0); assert.equal(race.state.events.length, 0);
  });
  await t.test("same original command replays once even after a later transition without restoring old state", async () => {
    const f = fixture(); const started = await f.run();
    const replay = await f.run(); assert.equal(replay.replayed, true); assert.equal(replay.appointment.version, 2);
    assert.equal(replay.appointment.startedAt?.toISOString(), started.appointment.startedAt?.toISOString());
    await f.run({ ...command("complete_service"), commandId: "attendance-complete", expectedVersion: 2 });
    const oldReplay = await f.run(); assert.equal(oldReplay.replayed, true); assert.equal(oldReplay.appointment.operationalStatus, "completed");
    assert.equal(oldReplay.appointment.version, 3); assert.equal(f.state.audits.length, 2); assert.equal(f.state.events.length, 2);
  });
  await t.test("receipt cannot cross actor, appointment, action or version identity", async () => {
    const f = fixture(); await f.run(); const before = structuredClone(f.state);
    for (const change of [{ action: "no_show" }, { expectedVersion: 2 }])
      await assert.rejects(f.run({ ...command(), ...change } as AttendanceTransitionCommand), /service_appointment_idempotency_conflict/);
    await assert.rejects(f.run(command(), { ...actor, userId: "other", role: "admin" }), /service_appointment_idempotency_conflict/);
    assert.deepEqual(f.state, before);
    const other = fixture(); await other.run(); other.state.appointment.id = "another-known-appointment";
    await assert.rejects(other.run({ ...command(), appointmentId: "another-known-appointment" }), /service_appointment_idempotency_conflict/);
  });
  await t.test("trusted owner/admin scope rejects staff, foreign tenant/id and body-injected financial/status/timestamp grants", async () => {
    const f = fixture(); await assert.rejects(f.run(command(), { ...actor, role: "staff" }), /service_operator_required/);
    await assert.rejects(f.run({ ...command(), appointmentId: "foreign" }), /service_appointment_not_found/);
    await assert.rejects(f.run(command(), { ...actor, merchantId: "foreign" }), /inventory_merchant_not_found|merchant_not_found/);
    for (const extra of [{ merchantId: "foreign" }, { actorId: "forged" }, { operationalStatus: "completed" },
      { receivedAt: "2030-01-02Z" }, { startedAt: "2030-01-02Z" }])
      await assert.rejects(f.run({ ...command(), ...extra }), /service_attendance_command_invalid/);
    assert.equal(f.state.appointment.version, 1); assert.equal(f.state.audits.length, 0);
  });
  await t.test("audit or outbox failure rolls the modeled operational row and timestamps back", async () => {
    for (const stage of ["audit", "outbox"]) { const f = fixture(), before = structuredClone(f.state); f.fail(stage);
      await assert.rejects(f.run(), /synthetic_attendance_/); assert.deepEqual(f.state, before); }
  });
  await t.test("post-lock server time is shared by the explicit timestamp, audit and compact event", async () => {
    const f = fixture(), fresh = new Date("2030-01-02T10:16:00Z"); f.advance(fresh);
    const result = await f.run(); assert.equal(result.appointment.startedAt?.toISOString(), fresh.toISOString());
    assert.equal(f.state.audits[0].occurredAt.toISOString(), fresh.toISOString()); assert.equal(f.state.events[0].occurredAt.toISOString(), fresh.toISOString());
    assert.deepEqual(f.state.events[0].payload, { appointmentId: "appointment", version: 2, operationalStatus: "in_service" });
    assert.equal(JSON.stringify(f.state.events).includes("private@example.test"), false);
    assert.equal(f.state.events[0].eventType, "service.appointment.in_service");
  });
  await t.test("root Prisma and malformed commands are refused before an operational write", async () => {
    const f = fixture(); await assert.rejects(transitionServiceAppointmentWithin(f.prisma as unknown as Prisma.TransactionClient, actor, command()),
      /service_attendance_transaction_required/);
    for (const change of [{ expectedVersion: 0 }, { commandId: "" }, { proof: {} }])
      await assert.rejects(f.run({ ...command(), ...change } as unknown as AttendanceTransitionCommand), /service_attendance_command_invalid|expected_version_required/);
    assert.equal(f.state.appointment.version, 1); assert.equal(f.state.audits.length, 0); assert.equal(f.state.events.length, 0);
  });
});
