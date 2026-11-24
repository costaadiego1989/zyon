import "reflect-metadata";
import test from "node:test";
import assert from "node:assert/strict";
import { ReadServiceAppointmentOperationSummary } from "./read-service-appointment-operation-summary.js";

const actor = { merchantId: "tenant-a", userId: "owner-a", role: "owner" };
const now = new Date("2027-01-04T12:00:00Z");
function fixture() {
  const reads: Array<[string, unknown]> = [];
  const state = {
    merchant: { businessMode: "services", businessModeSelectedAt: now, businessModeNeedsReview: false },
    appointment: { id: "appointment-a", version: 4, operationalStatus: "scheduled" } as any,
    payments: [{ id: "local-a", version: 3, mode: "at_attendance", status: "pending", amountCents: 6000, currency: "BRL",
      receivedAt: null, paymentIntentId: null, provider: null, providerPaymentId: null, providerEvidence: null }] as any[],
    groups: [] as any[], failure: null as Error | null, duringRead: null as (() => void) | null,
  };
  const tx = {
    merchant: { findUnique: async (input: unknown) => { reads.push(["merchant", input]); return state.merchant; } },
    serviceAppointment: { findFirst: async (input: unknown) => { reads.push(["appointment", input]); state.duringRead?.(); return state.appointment; } },
    appointmentPayment: { findMany: async (input: unknown) => { reads.push(["payments", input]); return state.payments; } },
    attendanceReceipt: { groupBy: async (input: unknown) => { reads.push(["receipts", input]); if (state.failure) throw state.failure; return state.groups; } },
    $queryRaw: async () => [{ asOf: now }],
  };
  const prisma = { $transaction: async (work: (value: typeof tx) => unknown, options: unknown) => {
    assert.deepEqual(options, { isolationLevel: "RepeatableRead" }); return work(tx);
  } };
  return { state, reads, read: (principal = actor, id = "appointment-a") => new ReadServiceAppointmentOperationSummary(prisma as never).execute(principal, id) };
}
const group = (amount = 1500, currency = "BRL", min = amount) => ({ appointmentPaymentId: "local-a", currency, _sum: { amountCents: amount }, _min: { amountCents: min } });

test("T80 canonical command review and integral local balance", async t => {
  await t.test("uses the current financial amount and historical receipts rather than a catalog or original booking price", async () => {
    const f = fixture(); f.state.groups = [group()]; const value = await f.read();
    assert.deepEqual(value, { merchantId: "tenant-a", appointmentId: "appointment-a", appointmentVersion: 4, asOf: now.toISOString(),
      attendanceActions: ["start_service", "no_show"], canReviewCancellation: true, canReviewRescheduling: true,
      localPayments: [{ paymentId: "local-a", paymentVersion: 3, currency: "BRL", balanceStatus: "available", receivedCents: 1500, remainingCents: 4500, canRecordReceipt: true }] });
    assert.deepEqual((f.reads.find(([kind]) => kind === "appointment")![1] as any).where, { merchantId: "tenant-a", id: "appointment-a" });
    assert.deepEqual((f.reads.find(([kind]) => kind === "payments")![1] as any).where, { merchantId: "tenant-a", appointmentId: "appointment-a" });
    assert.deepEqual((f.reads.find(([kind]) => kind === "receipts")![1] as any).where, { merchantId: "tenant-a", appointmentPaymentId: { in: ["local-a"] } });
    assert.equal(JSON.stringify(value).includes("providerEvidence"), false);
  });
  await t.test("keeps presence, cancellation and rescheduling independent of online approval", async () => {
    for (const [status, actions, cancel, reschedule] of [
      ["pending", [], true, true], ["scheduled", ["start_service", "no_show"], true, true],
      ["in_service", ["complete_service"], true, false], ["completed", [], false, false],
      ["no_show", [], false, false], ["cancelled", [], false, false],
    ] as const) {
      const f = fixture(); f.state.appointment.operationalStatus = status;
      f.state.payments = [{ ...f.state.payments[0], mode: "online", status: "approved", providerEvidence: { secret: "never-public" } }];
      const result = await f.read(); assert.deepEqual(result.attendanceActions, actions); assert.equal(result.canReviewCancellation, cancel);
      assert.equal(result.canReviewRescheduling, reschedule); assert.deepEqual(result.localPayments, []); assert.equal(JSON.stringify(result).includes("never-public"), false);
      assert.equal(f.reads.some(([kind]) => kind === "receipts"), false);
    }
  });
  await t.test("a fully recorded local payment has zero remaining without altering the attendance state", async () => {
    const f = fixture(); Object.assign(f.state.payments[0], { status: "approved", receivedAt: now }); f.state.groups = [group(6000)];
    const result = await f.read(); assert.deepEqual(result.localPayments[0], { paymentId: "local-a", paymentVersion: 3, currency: "BRL",
      balanceStatus: "not_payable", receivedCents: 6000, remainingCents: 0, canRecordReceipt: false });
    assert.deepEqual(result.attendanceActions, ["start_service", "no_show"]); assert.equal(f.state.appointment.operationalStatus, "scheduled");
  });
  await t.test("inconsistent historic currency, overpayment or nonpositive receipts never become an actionable balance", async () => {
    for (const value of [group(1500, "USD"), group(6001), group(0), group(1500, "BRL", 0), group(Number.MAX_SAFE_INTEGER + 1)]) {
      const f = fixture(); f.state.groups = [value]; const result = await f.read();
      assert.equal(result.localPayments[0].balanceStatus, "unavailable"); assert.equal(result.localPayments[0].remainingCents, null);
      assert.equal(result.localPayments[0].receivedCents, null); assert.equal(result.localPayments[0].canRecordReceipt, false);
    }
  });
  await t.test("provider-bound or already settled sources do not authorize recording another local payment", async () => {
    for (const change of [{ paymentIntentId: "intent" }, { provider: "provider" }, { providerPaymentId: "charge" },
      { providerEvidence: { private: "secret" } }, { status: "pending", receivedAt: now }, { status: "approved", receivedAt: now }, { amountCents: 0 }]) {
      const f = fixture(); Object.assign(f.state.payments[0], change); const result = await f.read();
      assert.equal(result.localPayments[0].canRecordReceipt, false); assert.equal(result.localPayments[0].remainingCents, null);
      assert.equal(JSON.stringify(result).includes("secret"), false);
    }
  });
  await t.test("staff and product-company attempts are denied before appointment or financial reads", async () => {
    const staff = fixture(); await assert.rejects(staff.read({ ...actor, role: "staff" }), /service_operator_required/); assert.deepEqual(staff.reads, []);
    const product = fixture(); product.state.merchant.businessMode = "products"; await assert.rejects(product.read(), /services_mode_required/);
    assert.deepEqual(product.reads.map(([kind]) => kind), ["merchant"]);
  });
  await t.test("missing appointments, invalid identifiers and source limits fail without inventing empty facts", async () => {
    const missing = fixture(); missing.state.appointment = null; await assert.rejects(missing.read(), /service_appointment_not_found/);
    assert.equal(missing.reads.some(([kind]) => kind === "payments"), false);
    const invalid = fixture(); await assert.rejects(invalid.read(actor, " foreign "), /appointment_id_invalid/); assert.deepEqual(invalid.reads, []);
    const bounded = fixture(); bounded.state.payments = Array.from({ length: 101 }, (_, i) => ({ ...bounded.state.payments[0], id: String(i) }));
    await assert.rejects(bounded.read(), /appointment_financial_source_limit/);
    const groups = fixture(); groups.state.groups = Array.from({ length: 101 }, () => group()); await assert.rejects(groups.read(), /appointment_receipt_source_limit/);
  });
  await t.test("a captured actor is stable across awaits and database errors remain errors", async () => {
    const f = fixture(), principal = { ...actor }; f.state.duringRead = () => { principal.merchantId = "tenant-b"; principal.userId = "owner-b"; };
    const result = await f.read(principal); assert.equal(result.merchantId, "tenant-a");
    assert.equal((f.reads.find(([kind]) => kind === "payments")![1] as any).where.merchantId, "tenant-a");
    const failure = fixture(); failure.state.failure = new Error("database-unavailable"); await assert.rejects(failure.read(), error => error === failure.state.failure);
  });
});
