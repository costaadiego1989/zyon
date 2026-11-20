import assert from "node:assert/strict";
import test from "node:test";
import { FiscalEligibilityService, type FiscalEligibilityInput } from "./fiscal-eligibility.service.js";

const service = new FiscalEligibilityService();
function input(): FiscalEligibilityInput {
  return { sale: { orderId: "provider_payment_1", orderMerchantId: "store", sessionId: "checkout", completedAt: new Date("2026-11-14T12:00:00Z"),
    currency: "BRL", totalCents: 1000, cancelledAt: null, transmittedAt: null },
  connection: { isActive: true, activatedAt: new Date("2026-11-14T11:00:00Z"), disconnectedAt: null },
  approval: { id: "persisted_approval", merchantId: "store", sessionId: "checkout", status: "approved", providerPaymentId: "provider_payment_1",
    currency: "BRL", amountCents: 1000, approvedAmountCents: 1000, acceptedOfferId: null, amountBreakdown: null } };
}
test("FISCAL-10 new completed sale with matching persisted approval is queued", () => {
  assert.deepEqual(service.evaluate(input()), { eligible: true, state: "queued", code: null, paymentProofRef: "persisted_approval" });
});
test("FISCAL-11 public completion without approval remains awaiting_payment", () => {
  assert.deepEqual(service.evaluate({ ...input(), approval: null }), { eligible: false, state: "awaiting_payment", code: "fiscal_payment_approval_required", paymentProofRef: null });
});
test("FISCAL-12 a delayed approval never makes an original preactivation sale eligible", () => {
  const value = input(); value.sale.completedAt = new Date("2026-11-14T10:59:59Z");
  assert.equal(service.evaluate(value).state, "not_eligible_before_activation");
  value.approval = null;
  assert.equal(service.evaluate(value).state, "not_eligible_before_activation");
});
test("the activation boundary uses the persisted instant inclusively", () => {
  const value = input(); value.sale.completedAt = new Date(value.connection!.activatedAt!);
  assert.equal(service.evaluate(value).eligible, true);
});
test("FISCAL-13 cancellation before transmission suppresses authorization", () => {
  const value = input(); value.sale.cancelledAt = new Date("2026-11-14T12:01:00Z");
  assert.equal(service.evaluate(value).state, "suppressed");
  assert.equal(service.evaluate(value).code, "fiscal_sale_cancelled");
});
test("a sale already transmitted requires review after cancellation", () => {
  const value = input(); value.sale.cancelledAt = new Date(); value.sale.transmittedAt = new Date("2026-11-14T12:00:30Z");
  assert.equal(service.evaluate(value).state, "action_required");
  assert.equal(service.evaluate(value).code, "fiscal_cancellation_review_required");
});
test("FISCAL-14 eligible issuance is independent of inventory synchronization mode", () => {
  for (const inventorySyncMode of ["bidirectional", "inbound_only", "disabled"]) {
    assert.equal(service.evaluate({ ...input(), inventorySyncMode }).state, "queued");
  }
});
test("pending failed or mismatched persisted payment evidence cannot authorize issuance", () => {
  for (const change of [{ status: "pending" }, { status: "failed" }, { merchantId: "other" }, { sessionId: "other" },
    { providerPaymentId: "other" }, { currency: "USD" }, { amountCents: 999 }, { approvedAmountCents: 999 }, { id: "" }]) {
    const value = input(); value.approval = { ...value.approval!, ...change };
    assert.equal(service.evaluate(value).state, "awaiting_payment", JSON.stringify(change));
  }
});
test("disconnected inactive or unactivated connections cannot create a queued sale", () => {
  for (const connection of [null, { isActive: false, activatedAt: new Date(), disconnectedAt: null },
    { isActive: true, activatedAt: null, disconnectedAt: null }, { isActive: true, activatedAt: new Date(), disconnectedAt: new Date() }]) {
    assert.equal(service.evaluate({ ...input(), connection }).code, "fiscal_connection_inactive");
  }
});
test("missing original commercial completion cannot be replaced by current time", () => {
  const value = input(); value.sale.completedAt = null;
  assert.equal(service.evaluate(value).code, "fiscal_sale_not_completed");
  assert.equal(service.evaluate(value).eligible, false);
});
