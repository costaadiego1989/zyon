import test from "node:test";
import assert from "node:assert/strict";
import { checkoutSession, completeOrderRequest } from "./checkout-test-fixtures.js";
import { InMemoryCheckoutRepository } from "../infrastructure/repositories/in-memory-checkout.repository.js";
import { CompleteOrderUseCase } from "../application/use-cases/complete-order.use-case.js";
import type { PersistedPaymentApproval } from "../domain/ports/payment-approval.port.js";
import { paymentCartFingerprint } from "../domain/services/payment-cart-fingerprint.js";

function setup() {
  const repository = new InMemoryCheckoutRepository();
  repository.saveSession(checkoutSession());
  const approval: PersistedPaymentApproval = {
    id: "intent-1", merchantId: "mrc_1", sessionId: "chk_1", status: "approved", currency: "BRL",
    amountCents: 35000, approvedAmountCents: 35000, providerPaymentId: "ord_1", acceptedOfferId: null,
    amountBreakdown: { version: 1, currency: "BRL", itemsSubtotalCents: 30000, discountCents: 0,
      shippingCents: 3500, platformFeeCents: 1500, totalCents: 35000, cartFingerprint: paymentCartFingerprint(checkoutSession()) },
  };
  const reader = { find: async () => approval };
  const useCase = new CompleteOrderUseCase(repository, repository, repository, repository,
    undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined,
    undefined, undefined, undefined, reader);
  return { repository, approval, useCase, request: completeOrderRequest({ order_total: 350 }) };
}

test("payment completion accepts the persisted card fee and emits an immutable sale snapshot once", async () => {
  const { repository, approval, useCase, request } = setup();
  assert.equal((await useCase.executePaymentApproval(request, approval.id)).idempotent, false);
  assert.equal((await useCase.executePaymentApproval(request, approval.id)).idempotent, true);
  assert.equal(repository.getCompletedOrder("mrc_1", "chk_1", "ord_1")?.orderTotal, 350);
  const events = repository.listOutbox("mrc_1").filter(e => e.event_type === "order.completed");
  assert.equal(events.length, 1);
  assert.deepEqual(events[0].payload.payment_amount_breakdown, approval.amountBreakdown);
  const sale = events[0].payload.inventory_sale as { items: unknown[]; totalCents: number };
  assert.deepEqual(sale.items, [{ sku: "kit", quantity: 1 }]);
  assert.equal(sale.totalCents, 35000);
  repository.saveSession(checkoutSession({ cart: { currency: "BRL", total: 1, items: [] } }));
  assert.equal((await useCase.executePaymentApproval(request, approval.id)).idempotent, true);
  assert.equal(repository.listOutbox("mrc_1").filter(event => event.event_type === "order.completed").length, 1);
  assert.deepEqual(sale.items, [{ sku: "kit", quantity: 1 }]);
});

test("HTTP completion cannot authorize a card fee by adding approval fields to its body", async () => {
  const { useCase, approval, request, repository } = setup();
  await assert.rejects(useCase.execute({ ...request, paymentIntentId: approval.id,
    amountBreakdown: approval.amountBreakdown } as typeof request), /order_total_mismatch/);
  assert.equal(repository.listOutbox("mrc_1").length, 0);
});

test("payment completion requires persisted proof for its exact merchant session provider and amount", async () => {
  for (const patch of [
    { merchantId: "other" }, { sessionId: "other" }, { status: "pending" },
    { providerPaymentId: "other" }, { currency: "USD" }, { approvedAmountCents: 1 },
    { acceptedOfferId: "unaccepted" },
  ]) {
    const { useCase, approval, request, repository } = setup();
    Object.assign(approval, patch);
    await assert.rejects(useCase.executePaymentApproval(request, "intent-1"), /payment_approval_mismatch/);
    assert.equal(repository.listOutbox("mrc_1").length, 0);
  }
  const { useCase, request } = setup();
  await assert.rejects(useCase.executePaymentApproval(request), /payment_approval_required/);
});

test("payment completion rejects a modified cart and an inconsistent persisted breakdown", async () => {
  const { repository, useCase, approval, request } = setup();
  repository.saveSession(checkoutSession({ shipping: { customerPrice: 40, realCost: 40, region: "SP" } }));
  await assert.rejects(useCase.executePaymentApproval(request, approval.id), /payment_cart_changed/);
  repository.saveSession(checkoutSession());
  approval.amountBreakdown!.platformFeeCents = 0;
  await assert.rejects(useCase.executePaymentApproval(request, approval.id), /payment_amount_breakdown_invalid/);
  assert.equal(repository.listOutbox("mrc_1").length, 0);
});

test("legacy persisted approvals without a breakdown must match the base cart exactly", async () => {
  const { repository, useCase, approval, request } = setup();
  approval.amountBreakdown = null;
  await assert.rejects(useCase.executePaymentApproval(request, approval.id), /payment_cart_changed/);
  approval.amountCents = approval.approvedAmountCents = 33500;
  await useCase.executePaymentApproval({ ...request, order_total: 335 }, approval.id);
  assert.equal(repository.getCompletedOrder("mrc_1", "chk_1", "ord_1")?.orderTotal, 335);
});

test("payment completion rejects a different SKU or variant with the same total", async () => {
  for (const patch of [{ sku: "other" }, { variant: "other" }]) {
    const { repository, useCase, approval, request } = setup();
    const session = checkoutSession();
    Object.assign(session.cart.items[0], patch);
    repository.saveSession(session);
    await assert.rejects(useCase.executePaymentApproval(request, approval.id), /payment_cart_changed/);
    assert.equal(repository.listOutbox("mrc_1").length, 0);
  }
});
