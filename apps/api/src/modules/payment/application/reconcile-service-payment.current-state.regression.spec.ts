import assert from "node:assert/strict";
import test from "node:test";
import { ReconcileServicePaymentUseCase, regularizationIdentity } from "./reconcile-service-payment.use-case.js";
import { InMemoryDomainEventBus } from "../../../shared/events/in-memory-domain-event-bus.js";
import { TenantContextService } from "../../../shared/tenant/tenant-context.service.js";

// BOOK-06/08: replay must report today's booking state while the original
// regularization remains an immutable historical financial receipt.
test("T36 replay reports current canonical booking without rewriting its regularization receipt", async t => {
  function fixture(input: { originalConfirmed: boolean; originalAppointmentId?: string; currentStatus: string; boundToOrder: boolean }) {
    const merchantId = "merchant", paymentIntentId = "intent", orderId = "order", unitId = "unit", appointmentId = "appointment";
    const payment = { id: paymentIntentId, merchantId, sessionId: "session", status: "approved", providerPaymentId: "provider",
      amountCents: 5000, approvedAmountCents: 5000, currency: "BRL" };
    const receipt = { id: "service-payment-regularization:" + regularizationIdentity(merchantId, paymentIntentId, orderId, unitId),
      merchantId, type: "service_payment_regularization", metadata: { schemaVersion: 1, paymentIntentId, orderId, unitId,
        reason: "service_manual_payment_snapshot_changed", bookingConfirmed: input.originalConfirmed,
        ...(input.originalAppointmentId ? { appointmentId: input.originalAppointmentId } : {}) } };
    const current = { id: appointmentId, merchantId, operationalStatus: input.currentStatus,
      orderId: input.boundToOrder ? orderId : null, orderUnitId: input.boundToOrder ? unitId : null };
    const persisted = { payment, receipt, appointment: current, events: [{ id: receipt.id, payload: structuredClone(receipt.metadata) }] };
    const before = structuredClone(persisted);
    const noWrite = async () => { assert.fail("replay cannot rewrite historical payment notification or outbox receipts"); };
    const tx = {
      $queryRaw: async () => [{ id: merchantId }],
      paymentIntent: { findFirst: async ({ where }: any) => { assert.deepEqual(where, { id: paymentIntentId, merchantId }); return payment; } },
      completedOrder: { findFirst: async () => ({ id: orderId, merchantId, sessionId: "session", status: "approved", currency: "BRL",
        externalOrderId: "provider", orderTotal: 50, lineItemsJson: [{ lineId: unitId, productType: "service", fulfillmentStrategy: "scheduled_service" }] }) },
      merchantNotification: { findUnique: async ({ where }: any) => { assert.equal(where.id, receipt.id); return receipt; }, create: noWrite },
      serviceAppointment: { findFirst: async ({ where }: any) => {
        assert.equal(where.merchantId, merchantId, "current state must retain tenant scope");
        return where.id === current.id || input.boundToOrder && where.orderId === orderId && where.orderUnitId === unitId ? current : null;
      }, updateMany: noWrite },
      appointmentPayment: { updateMany: noWrite }, outboxMessage: { create: noWrite },
    };
    const command = new ReconcileServicePaymentUseCase({ $transaction: (work: any) => work(tx) } as any,
      new InMemoryDomainEventBus(), new TenantContextService());
    return { run: () => command.execute(merchantId, paymentIntentId), persisted, before, appointmentId };
  }
  await t.test("a later cancellation cannot replay the original confirmed flag", async () => {
    const f = fixture({ originalConfirmed: true, originalAppointmentId: "appointment", currentStatus: "cancelled", boundToOrder: true });
    const result = await f.run(); assert.equal(result.units[0].bookingConfirmed, false);
    assert.equal(result.units[0].appointmentId, f.appointmentId); assert.deepEqual(f.persisted, f.before);
  });
  await t.test("a later legitimate manual resolution reports its current linked appointment", async () => {
    const f = fixture({ originalConfirmed: false, originalAppointmentId: "appointment", currentStatus: "scheduled", boundToOrder: false });
    const result = await f.run(); assert.equal(result.units[0].bookingConfirmed, true);
    assert.equal(result.units[0].appointmentId, f.appointmentId); assert.deepEqual(f.persisted, f.before);
  });
  await t.test("a receipt without an appointment does not hide a later actual canonical unit binding", async () => {
    const f = fixture({ originalConfirmed: false, currentStatus: "scheduled", boundToOrder: true });
    const result = await f.run(); assert.equal(result.units[0].bookingConfirmed, true);
    assert.equal(result.units[0].appointmentId, f.appointmentId); assert.deepEqual(f.persisted, f.before);
  });
});
