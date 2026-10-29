import test from "node:test";
import assert from "node:assert/strict";
import type { Prisma } from "@prisma/client";
import type { CompleteOrderRequest, CompletedOrder, CheckoutEventName } from "@zyon/shared-types";
import { InMemoryCheckoutRepository } from "../infrastructure/repositories/in-memory-checkout.repository.js";
import { CompleteOrderUseCase } from "../application/use-cases/complete-order.use-case.js";
import type { PersistedPaymentApproval } from "../domain/ports/payment-approval.port.js";
import { widgetPaymentAuthorityFixture } from "../../payment/domain/widget-checkout-payment.fixture.js";
import { assertWidgetPaymentOrderInTransaction } from "../infrastructure/adapters/widget-payment-order-authority.js";

function setup(withTransaction = true) {
  const f = widgetPaymentAuthorityFixture(), repository = new InMemoryCheckoutRepository();
  const approval: PersistedPaymentApproval = { id: "payment", merchantId: "merchant", sessionId: "checkout", status: "approved", currency: "BRL",
    amountCents: 12849, approvedAmountCents: 12849, providerPaymentId: "provider", acceptedOfferId: null,
    amountBreakdown: f.authority.amountBreakdown, widgetCheckoutAuthority: structuredClone(f.authority) };
  const actual = { ...f.scope, version: 3, status: "approved", approvedAmountCents: 12849, providerPaymentId: "provider", acceptedOfferId: null };
  const state = { genericReads: 0, guards: 0, quota: 0, saves: 0, refundBeforeCommit: false, events: [] as CheckoutEventName[] };
  repository.getSession = () => { state.genericReads++; throw new Error("generic_mapper_must_not_read_widget_base"); };
  const tx = { async $queryRaw() { return []; }, paymentIntent: { async findFirst() { return actual; } } } as unknown as Prisma.TransactionClient;
  const commit = {
    async assertWidgetPaymentOrderAuthority(m: string, s: string, a: unknown, p: string, provider: string) {
      state.guards++; await assertWidgetPaymentOrderInTransaction(tx, m, s, a, p, provider);
    },
    async assertCouponOrderAuthority() { throw new Error("generic_coupon_guard_must_not_be_relaxed"); },
    async saveCompletedOrder(order: CompletedOrder) { state.saves++; return repository.saveCompletedOrder(order); },
    async recordCompletedOrderQuota() { state.quota++; },
    // Real Prisma recordEvent writes a technical event directly and does NOT
    // use getSession/the generic cart mapper. Do not inherit the memory double's
    // mapper-based score update, which would create an artificial read here.
    async recordEvent(_m: string, _s: string, event: CheckoutEventName) { state.events.push(event); },
    appendOutbox: repository.appendOutbox.bind(repository),
  };
  const runner = { async transaction<T>(work: (repo: typeof commit) => Promise<T>) {
    if (state.refundBeforeCommit) actual.status = "refunded";
    return work(commit);
  } };
  const useCase = new CompleteOrderUseCase(repository, repository, repository, undefined, undefined, undefined, undefined,
    withTransaction ? runner : undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined,
    { find: async () => approval });
  const request: CompleteOrderRequest = { merchant_id: "merchant", session_id: "checkout", external_order_id: "provider", order_total: 127, currency: "BRL" };
  return { ...f, approval, actual, repository, useCase, request, state };
}

test("paid widget completion uses frozen lines, selected shipping and contacts, excluding buyer fee exactly once", async () => {
  const f = setup(); assert.equal((await f.useCase.executePaymentApproval(f.request, "payment")).idempotent, false);
  const order = f.repository.getCompletedOrder("merchant", "checkout", "provider")!;
  assert.equal(order.orderTotal, 127); assert.equal(order.shippingCents, 900);
  assert.deepEqual(order.lineItems!.map(line => [line.sku, line.unitPriceCents, line.quantity]), [["TRIGGER", 10000, 1], ["TARGET", 1800, 1]]);
  const events = f.repository.listOutbox("merchant"), confirmation = events.find(e => e.event_type === "order.confirmed")!;
  assert.equal(confirmation.payload.buyerEmail, "buyer@example.test"); assert.equal(confirmation.payload.total, "127.00");
  const completed = events.find(e => e.event_type === "order.completed")!;
  assert.equal((completed.payload.inventory_sale as { totalCents: number }).totalCents, 12700);
  assert.deepEqual(completed.payload.payment_amount_breakdown, f.authority.amountBreakdown);
  assert.equal(f.state.genericReads, 0); assert.equal(f.state.guards, 1); assert.equal(f.state.quota, 1);
  assert.deepEqual(f.state.events, ["order_completed"]);
  for (const privateKey of ["widgetCheckoutAuthority", "contextHash", "acceptanceEventId", "creation", "otp_code"])
    assert.equal(JSON.stringify(events).includes(privateKey), false);
});
test("changed or missing current catalog/contact/receipt cannot reprice an admitted historical approval or duplicate order/outbox", async () => {
  const f = setup(); await f.useCase.executePaymentApproval(f.request, "payment");
  // The generic session reader throws: later catalog/contact/TTL is not an
  // input at all. The transaction still rechecks the actual approved journal.
  const before = structuredClone(f.repository.listOutbox("merchant"));
  assert.equal((await f.useCase.executePaymentApproval(f.request, "payment")).idempotent, true);
  assert.deepEqual(f.repository.listOutbox("merchant"), before); assert.equal(f.state.quota, 1); assert.equal(f.state.genericReads, 0);
  assert.deepEqual(f.state.events, ["order_completed"]);
});
for (const fault of ["status", "refund", "provider", "amount", "id", "buyer", "missing", "undefined", "breakdown", "discount-again"] as const)
  test(`frozen approval refuses ${fault} before an order write`, async () => {
    const f = setup();
    if (fault === "status") f.approval.status = "pending";
    if (fault === "refund") f.approval.status = "refunded";
    if (fault === "provider") f.approval.providerPaymentId = "foreign";
    if (fault === "amount") f.approval.approvedAmountCents = 12848;
    if (fault === "id") f.approval.id = "foreign";
    if (fault === "buyer") f.approval.widgetCheckoutAuthority!.buyerId = "foreign";
    if (fault === "missing") f.approval.widgetCheckoutAuthority = null as unknown as typeof f.approval.widgetCheckoutAuthority;
    if (fault === "undefined") f.approval.widgetCheckoutAuthority = undefined;
    if (fault === "breakdown") f.approval.amountBreakdown!.shippingCents++;
    if (fault === "discount-again") f.approval.amountBreakdown!.discountCents = 200;
    await assert.rejects(f.useCase.executePaymentApproval(f.request, "payment")); assert.equal(f.state.saves, 0); assert.equal(f.state.genericReads, 0);
    assert.equal(f.repository.listOutbox("merchant").length, 0);
  });
test("a parsed sibling cannot replace actual journal identity inside order commit transaction", async () => {
  const f = setup(); f.approval.widgetCheckoutAuthority!.acceptanceEventId = "forged-parseable";
  await assert.rejects(f.useCase.executePaymentApproval(f.request, "payment")); assert.equal(f.state.guards, 1); assert.equal(f.state.saves, 0);
});
test("refund racing after approval read is rejected by actual row check before save/order/outbox", async () => {
  const f = setup(); f.state.refundBeforeCommit = true;
  await assert.rejects(f.useCase.executePaymentApproval(f.request, "payment")); assert.equal(f.state.saves, 0); assert.equal(f.state.quota, 0);
});
test("widget frozen completion requires explicit transaction composition", async () => {
  const f = setup(false); await assert.rejects(f.useCase.executePaymentApproval(f.request, "payment"));
  assert.equal(f.state.saves, 0); assert.equal(f.state.genericReads, 0);
});
test("public body cannot opt into the persisted frozen approval path", async () => {
  const f = setup(); await assert.rejects(f.useCase.execute({ ...f.request, widgetCheckoutAuthority: f.authority } as CompleteOrderRequest));
  assert.equal(f.state.guards, 0); assert.equal(f.repository.listOutbox("merchant").length, 0);
});
