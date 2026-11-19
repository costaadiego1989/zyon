import assert from "node:assert/strict";
import test from "node:test";
import type { Prisma, PrismaClient } from "@prisma/client";
import { RecordAttendanceReceiptUseCase, recordAttendanceReceiptWithin,
  type AttendanceReceiptCommand } from "./record-attendance-receipt.use-case.js";

const actor = { merchantId: "services", userId: "operator", role: "owner" };
const now = new Date("2030-01-02T12:00:00.000Z");
const command = (): AttendanceReceiptCommand => ({ appointmentId: "appointment", paymentId: "local-payment",
  expectedPaymentVersion: 1, amountCents: 5000, currency: "BRL", paymentMethod: "Pix presencial", commandId: "receipt-first" });

// Models resulting records/rollback only. Actual PostgreSQL locks, FK/CAS and
// concurrent commands are exercised separately through the real HTTP fixture.
function fixture(status = "scheduled") {
  let state: any = {
    merchant: { businessMode: "services", businessModeSelectedAt: new Date("2029-01-01Z"), businessModeNeedsReview: false },
    appointment: { id: "appointment", merchantId: actor.merchantId, professionalId: "professional", version: 3,
      priceInCents: 5000, currency: "BRL", operationalStatus: status, startsAt: new Date("2030-01-03T10:00Z"),
      endsAt: new Date("2030-01-03T10:20Z"), customerSnapshot: { name: "Private buyer", email: "private@example.test" },
      policySnapshot: { paymentMode: "at_attendance", holdEnabled: false }, requestFingerprint: "original-admission" },
    payment: { id: "local-payment", merchantId: actor.merchantId, appointmentId: "appointment", mode: "at_attendance", status: "pending",
      amountCents: 5000, currency: "BRL", version: 1, receivedAt: null, paymentIntentId: null, provider: null, providerPaymentId: null,
      providerEvidence: null, requiresRegularization: false, regularizationReason: null,
      requestFingerprint: "immutable-initial-price-5000", idempotencyKey: "at-attendance:appointment", updatedAt: new Date("2030-01-01Z") },
    receipts: [], audits: [], events: [],
  };
  let failure = "", loseCas = false, clock = now, financialLock: (() => void) | undefined;
  const forbidden = async () => assert.fail("local receipt cannot modify appointment, provider, order, stock or admission policy");
  const scopedPayment = (where: any) => where.id === state.payment.id && where.merchantId === state.payment.merchantId
    && (where.appointmentId === undefined || where.appointmentId === state.payment.appointmentId);
  const rows = (where: any) => state.receipts.filter((row: any) => row.merchantId === where.merchantId && row.appointmentPaymentId === where.appointmentPaymentId);
  const tx = {
    $queryRaw: async (query: any) => {
      const sql = (Array.isArray(query) ? query : query.strings ?? []).join("");
      if (sql.includes("appointment_payments")) financialLock?.();
      return sql.includes("clock_timestamp") ? [{ now: new Date(clock) }] : [{ id: "locked" }];
    },
    merchant: { findUnique: async ({ where }: any) => where.id === actor.merchantId ? state.merchant : null },
    product: { count: async () => 0 }, serviceReservation: { count: async () => 0, updateMany: forbidden },
    serviceAppointment: { findFirst: async ({ where }: any) => where.id === state.appointment.id && where.merchantId === state.appointment.merchantId
      ? { ...state.appointment } : null, updateMany: forbidden, update: forbidden, create: forbidden },
    appointmentPayment: {
      findFirst: async ({ where }: any) => scopedPayment(where) ? { ...state.payment } : null,
      updateMany: async ({ where, data }: any) => {
        if (loseCas || !scopedPayment(where) || where.version !== state.payment.version || where.status !== state.payment.status
          || where.mode !== state.payment.mode || where.receivedAt !== state.payment.receivedAt) return { count: 0 };
        const { version, ...fields } = data; Object.assign(state.payment, fields); state.payment.version += version.increment; return { count: 1 };
      }, create: forbidden,
    },
    attendanceReceipt: {
      findUnique: async ({ where }: any) => state.receipts.find((x: any) => x.merchantId === where.merchantId_idempotencyKey.merchantId
        && x.idempotencyKey === where.merchantId_idempotencyKey.idempotencyKey) ?? null,
      findFirst: async ({ where }: any) => rows(where).find((x: any) => x.currency !== state.payment.currency || x.amountCents <= 0) ?? null,
      aggregate: async ({ where }: any) => ({ _sum: { amountCents: rows(where).reduce((sum: number, x: any) => sum + x.amountCents, 0) } }),
      create: async ({ data }: any) => { if (failure === "receipt") throw new Error("synthetic_receipt_insert_failure"); state.receipts.push(data); return { ...data }; },
    },
    appointmentAudit: {
      findUnique: async ({ where }: any) => state.audits.find((x: any) => x.merchantId === where.merchantId_commandId.merchantId
        && x.commandId === where.merchantId_commandId.commandId) ?? null,
      create: async ({ data }: any) => { if (failure === "audit") throw new Error("synthetic_receipt_audit_failure"); state.audits.push(data); return data; },
    },
    outboxMessage: { create: async ({ data }: any) => { if (failure === "outbox") throw new Error("synthetic_receipt_outbox_failure"); state.events.push(data); return data; } },
    paymentIntent: { findFirst: forbidden, update: forbidden, create: forbidden }, completedOrder: { findFirst: forbidden, update: forbidden },
    inventoryMovement: { create: forbidden }, productStock: { update: forbidden, updateMany: forbidden },
  } as unknown as Prisma.TransactionClient;
  const prisma = { $transaction: async (work: (tx: Prisma.TransactionClient) => Promise<unknown>) => {
    const before = structuredClone(state); try { return await work(tx); } catch (error) { state = before; throw error; }
  } } as unknown as PrismaClient;
  return { tx, prisma, get state() { return state; }, fail: (value: string) => { failure = value; }, loseCas: () => { loseCas = true; },
    onFinancialLock: (value: () => void) => { financialLock = value; }, advance: (value: Date) => { clock = value; },
    run: (input = command(), principal = actor) => new RecordAttendanceReceiptUseCase(prisma).execute(principal, input, { clock: () => new Date(clock) }) };
}

test("T37 integral local receipt preserves independent financial and attendance facts", async t => {
  await t.test("exact integral receipt records trusted operator/time and one local financial audit/event", async () => {
    const f = fixture(), appointment = structuredClone(f.state.appointment), result = await f.run();
    assert.equal(result.source, "recorded_at_attendance"); assert.equal(result.replayed, false);
    assert.equal(result.receipt.amountCents, 5000); assert.equal(result.receipt.currency, "BRL");
    assert.equal(result.receipt.paymentMethod, "Pix presencial"); assert.equal(result.receipt.operatorId, actor.userId);
    assert.equal(result.receipt.receivedAt.toISOString(), now.toISOString()); assert.equal(result.payment.id, "local-payment");
    assert.equal(result.payment.mode, "at_attendance"); assert.equal(result.payment.status, "approved"); assert.equal(result.payment.version, 2);
    assert.equal(result.payment.receivedAt?.toISOString(), now.toISOString()); assert.equal(f.state.receipts.length, 1);
    assert.deepEqual(f.state.appointment, appointment); assert.equal(f.state.audits.length, 1); assert.equal(f.state.audits[0].actorId, actor.userId);
    assert.equal(f.state.audits[0].version, 3); assert.equal(f.state.audits[0].action, "attendance_receipt");
    assert.equal(f.state.audits[0].after.receiptId, result.receipt.id); assert.equal(f.state.audits[0].after.paymentVersion, 2);
    assert.equal(f.state.events.length, 1); assert.equal(f.state.events[0].eventType, "service.payment.recorded_at_attendance");
    assert.deepEqual(f.state.events[0].payload, { appointmentId: "appointment", appointmentVersion: 3,
      paymentId: "local-payment", paymentVersion: 2, receiptId: result.receipt.id });
    assert.equal(f.state.events[0].merchantId, actor.merchantId); assert.equal(f.state.events[0].correlationId, "appointment");
    assert.equal(f.state.events[0].causationId, command().commandId); assert.equal(f.state.events[0].occurredAt.toISOString(), now.toISOString());
    for (const text of ["private@example.test", "Private buyer", "providerEvidence", "requestFingerprint"])
      assert.equal(JSON.stringify(result).includes(text), false);
  });
  await t.test("payment records never change any operational state, coordinates or appointment version", async () => {
    for (const status of ["pending", "scheduled", "in_service", "completed", "no_show", "cancelled"]) {
      const f = fixture(status), before = structuredClone(f.state.appointment); await f.run(); assert.deepEqual(f.state.appointment, before);
    }
  });
  await t.test("same original command returns original receipt and today's financial state after a later attendance transition", async () => {
    const f = fixture(), first = await f.run(); f.state.appointment.version = 4; f.state.appointment.operationalStatus = "completed";
    const before = structuredClone(f.state); f.advance(new Date("2031-01-01Z")); const replay = await f.run();
    assert.equal(replay.replayed, true); assert.deepEqual(replay.receipt, first.receipt); assert.deepEqual(replay.payment, first.payment);
    assert.deepEqual(f.state, before);
  });
  await t.test("same key cannot adopt changed amount, method, currency, payment, version, actor or appointment", async () => {
    const f = fixture(); await f.run(); const before = structuredClone(f.state);
    for (const change of [{ amountCents: 4999 }, { paymentMethod: "Dinheiro" }, { currency: "USD" }, { expectedPaymentVersion: 2 }])
      await assert.rejects(f.run({ ...command(), ...change }), /service_receipt_idempotency_conflict/);
    await assert.rejects(f.run(command(), { ...actor, userId: "other", role: "admin" }), /service_receipt_idempotency_conflict/);
    assert.deepEqual(f.state, before);
    f.state.appointment.id = "another"; f.state.payment.appointmentId = "another";
    await assert.rejects(f.run({ ...command(), appointmentId: "another" }), /service_receipt_idempotency_conflict/);
  });
  await t.test("a new key cannot settle an already settled local obligation", async () => {
    const f = fixture(); await f.run(); const before = structuredClone(f.state);
    await assert.rejects(f.run({ ...command(), commandId: "second-key", expectedPaymentVersion: 2 }), /service_local_payment_already_settled/);
    assert.deepEqual(f.state, before);
  });
  await t.test("the same key cannot adopt its original receipt for a second valid local obligation in the same tenant", async () => {
    const first = fixture(), original = await first.run(), firstBefore = structuredClone(first.state);
    const second = fixture(); second.state.appointment.id = "appointment-second";
    second.state.payment.id = "local-payment-second"; second.state.payment.appointmentId = "appointment-second";
    second.state.payment.idempotencyKey = "at-attendance:appointment-second";
    // Both obligations are valid within the tenant. The shared immutable command
    // history belongs to the first one, not the selected pending financial row.
    second.state.receipts = structuredClone(first.state.receipts);
    second.state.audits = structuredClone(first.state.audits);
    second.state.events = structuredClone(first.state.events);
    const before = structuredClone(second.state);
    await assert.rejects(second.run({ ...command(), appointmentId: "appointment-second", paymentId: "local-payment-second" }), /service_receipt_idempotency_conflict/);
    assert.deepEqual(first.state, firstBefore); assert.deepEqual(second.state, before);
    assert.equal(second.state.payment.status, "pending"); assert.equal(second.state.payment.version, 1); assert.equal(second.state.payment.receivedAt, null);
    assert.equal(second.state.receipts.length, 1); assert.equal(second.state.receipts[0].id, original.receipt.id);
    assert.equal(second.state.receipts[0].appointmentPaymentId, "local-payment"); assert.equal(second.state.receipts[0].amountCents, 5000);
    assert.equal(second.state.audits.length, 1); assert.equal(second.state.audits[0].appointmentId, "appointment");
    assert.equal(second.state.events.length, 1); assert.equal(second.state.events[0].payload.paymentId, "local-payment");
  });
  await t.test("the current rescheduled balance/version wins over the original creation fingerprint and catalog price", async () => {
    const f = fixture(); f.state.appointment.priceInCents = 6000; f.state.appointment.version = 4;
    f.state.payment.amountCents = 6000; f.state.payment.version = 2;
    const identity = f.state.payment.requestFingerprint;
    const result = await f.run({ ...command(), expectedPaymentVersion: 2, amountCents: 6000 });
    assert.equal(result.receipt.amountCents, 6000); assert.equal(result.payment.version, 3);
    assert.equal(f.state.payment.requestFingerprint, identity); assert.equal(f.state.appointment.version, 4);
  });
  await t.test("historical local receipts reduce the remaining balance but the new receipt is exactly integral", async () => {
    const f = fixture(); f.state.receipts.push({ id: "historical", merchantId: actor.merchantId, appointmentPaymentId: "local-payment",
      amountCents: 1500, currency: "BRL", paymentMethod: "Cash", operatorId: "historic-operator", receivedAt: new Date("2029-12-31Z"),
      idempotencyKey: "historical", requestFingerprint: "historical" });
    const history = structuredClone(f.state.receipts[0]); await assert.rejects(f.run({ ...command(), amountCents: 3000 }), /service_receipt_amount_mismatch/);
    const result = await f.run({ ...command(), amountCents: 3500 }); assert.equal(result.receipt.amountCents, 3500);
    assert.equal(f.state.receipts.reduce((sum: number, x: any) => sum + x.amountCents, 0), 5000); assert.deepEqual(f.state.receipts[0], history);
  });
  await t.test("inconsistent historical receipt amounts/currency are refused without inventing an outstanding balance", async () => {
    for (const historical of [{ amountCents: 5001, currency: "BRL" }, { amountCents: 1, currency: "USD" }, { amountCents: 0, currency: "BRL" }]) {
      const f = fixture(); f.state.receipts.push({ ...historical, merchantId: actor.merchantId, appointmentPaymentId: "local-payment" });
      const before = structuredClone(f.state); await assert.rejects(f.run(), /service_receipt_balance_invalid/); assert.deepEqual(f.state, before);
    }
  });
  await t.test("partial, overpayment, foreign currency and stale financial version do not write", async () => {
    for (const [change, message] of [[{ amountCents: 4999 }, /service_receipt_amount_mismatch/], [{ amountCents: 5001 }, /service_receipt_amount_mismatch/],
      [{ currency: "USD" }, /service_receipt_currency_mismatch/], [{ expectedPaymentVersion: 2 }, /service_financial_version_conflict/]] as const) {
      const f = fixture(), before = structuredClone(f.state); await assert.rejects(f.run({ ...command(), ...change }), message); assert.deepEqual(f.state, before);
    }
  });
  await t.test("strict validated input cannot grant actor, timestamp, tenant, PSP or financial status", async () => {
    for (const change of [{ amountCents: 0 }, { amountCents: -1 }, { amountCents: 1.5 }, { amountCents: 2147483648 }, { currency: "brl" },
      { paymentMethod: "" }, { paymentMethod: "Cash\nForged" }, { commandId: "" }, { merchantId: "foreign" }, { operatorId: "forged" },
      { receivedAt: now.toISOString() }, { providerPaymentId: "forged" }, { status: "approved" }]) {
      const f = fixture(), before = structuredClone(f.state); await assert.rejects(f.run({ ...command(), ...change }), /service_receipt_command_invalid/); assert.deepEqual(f.state, before);
    }
    const f = fixture(); await assert.rejects(f.run({ ...command(), expectedPaymentVersion: 0 }), /expected_version_required/);
  });
  await t.test("only scoped owner/admin service administration may record a receipt", async () => {
    const admin = fixture(); assert.equal((await admin.run(command(), { ...actor, role: "admin" })).receipt.operatorId, actor.userId);
    const staff = fixture(), before = structuredClone(staff.state); await assert.rejects(staff.run(command(), { ...actor, role: "staff" }), /service_operator_required/);
    assert.deepEqual(staff.state, before);
    const products = fixture(); products.state.merchant.businessMode = "products";
    await assert.rejects(products.run(), /services_mode_required/);
    const review = fixture(); review.state.merchant.businessModeNeedsReview = true;
    await assert.rejects(review.run(), /business_mode_classification_required/);
    await assert.rejects(fixture().run({ ...command(), appointmentId: "foreign" }), /service_appointment_not_found/);
    await assert.rejects(fixture().run({ ...command(), paymentId: "foreign" }), /service_payment_not_found/);
  });
  await t.test("online/PSP-linked and unsupported financial states are never settled through local receipt", async () => {
    for (const change of [{ mode: "online" }, { paymentIntentId: "intent" }, { provider: "asaas" }, { providerPaymentId: "psp" }, { providerEvidence: {} }]) {
      const f = fixture(); Object.assign(f.state.payment, change); const before = structuredClone(f.state);
      await assert.rejects(f.run(), /service_local_payment_required/); assert.deepEqual(f.state, before);
    }
    for (const status of ["approved", "cancelled", "failed", "refunded", "partially_refunded"]) {
      const f = fixture(); f.state.payment.status = status; const before = structuredClone(f.state);
      await assert.rejects(f.run(), /service_local_payment_already_settled/); assert.deepEqual(f.state, before);
    }
  });
  await t.test("lost financial CAS rolls back a receipt without touching appointment", async () => {
    const f = fixture(), before = structuredClone(f.state); f.loseCas(); await assert.rejects(f.run(), /service_financial_version_conflict/); assert.deepEqual(f.state, before);
  });
  await t.test("receipt, audit and outbox failures roll back all four local financial effects", async () => {
    for (const stage of ["receipt", "audit", "outbox"]) {
      const f = fixture(), before = structuredClone(f.state); f.fail(stage); await assert.rejects(f.run(), /synthetic_receipt_/); assert.deepEqual(f.state, before);
    }
  });
  await t.test("original primitive actor/command survive awaited locks and the receipt uses fresh server time", async () => {
    const f = fixture(), input = command(), principal = { ...actor }, fresh = new Date("2030-01-02T12:01:00.000Z");
    f.onFinancialLock(() => { input.amountCents = 1; principal.userId = "changed-later"; f.advance(fresh); });
    const result = await f.run(input, principal); assert.equal(result.receipt.amountCents, 5000);
    assert.equal(result.receipt.operatorId, actor.userId); assert.equal(result.receipt.receivedAt.toISOString(), fresh.toISOString());
    assert.equal(f.state.events[0].occurredAt.toISOString(), fresh.toISOString());
  });
  await t.test("root clients and invalid server clocks cannot leave financial effects", async () => {
    const f = fixture(); await assert.rejects(recordAttendanceReceiptWithin(f.prisma as unknown as Prisma.TransactionClient, actor, command()), /service_receipt_transaction_required/);
    const before = structuredClone(f.state); f.advance(new Date("invalid")); await assert.rejects(f.run(), /service_receipt_clock_invalid/); assert.deepEqual(f.state, before);
  });
  await t.test("an unrelated audit or an incomplete historical command cannot be adopted as receipt replay", async () => {
    const f = fixture(); f.state.audits.push({ merchantId: actor.merchantId, commandId: command().commandId, action: "reschedule" });
    const before = structuredClone(f.state); await assert.rejects(f.run(), /service_receipt_idempotency_conflict/); assert.deepEqual(f.state, before);
    const g = fixture(); await g.run(); g.state.audits.length = 0; const corrupt = structuredClone(g.state);
    await assert.rejects(g.run(), /service_receipt_idempotency_conflict/); assert.deepEqual(g.state, corrupt);
  });
});
