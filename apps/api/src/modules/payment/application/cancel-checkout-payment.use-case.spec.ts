import test from "node:test";
import assert from "node:assert/strict";
import { CancelCheckoutPaymentUseCase } from "./cancel-checkout-payment.use-case.js";
import { PaymentIntentEntity } from "../domain/payment-intent.entity.js";
import { InMemoryPaymentRepository } from "../infrastructure/in-memory-payment.repository.js";
import { CancelPaymentIntentUseCase } from "./cancel-payment-intent.use-case.js";
import type { PendingPaymentCancellationInput } from "../domain/pending-payment-cancellation.js";

async function setup() {
  const repo = new InMemoryPaymentRepository();
  const intent = PaymentIntentEntity.create({ merchantId: "store", sessionId: "session", method: "pix",
    amountCents: 12099, currency: "BRL", idempotencyKey: "first" });
  intent.prepareCreation({ merchantId: "store", sessionId: "session", intentId: intent.id, method: "pix",
    amountCents: 12099, currency: "BRL", provider: "asaas", providerAccountFingerprint: "frozen-account",
    settlementMode: "immediate_split" });
  intent.claimCreation("fixture-create", new Date());
  intent.markRequiresAction({ providerPaymentId: "pay_test" }); intent.completeCreation("fixture-create");
  await repo.saveIntent({ intent });
  const calls: PendingPaymentCancellationInput[] = [];
  let state: "cancelled" | "paid" | "unknown" = "cancelled";
  const provider = { createPayment: async () => { throw new Error("must not charge"); },
    readCancellationStatus: async () => ({ state: state === "paid" ? "paid" as const : "pending" as const }),
    cancelPendingPayment: async (input: PendingPaymentCancellationInput) => { calls.push(input); return { state }; } };
  const buyer = { globalUserId: "buyer", customer: { email: "buyer@example.test", email_verified: true as const } };
  const session = { merchantId: "store", sessionId: "session", globalUserId: "buyer", cart: { items: [] } };
  const cancel = new CancelCheckoutPaymentUseCase(repo, new CancelPaymentIntentUseCase(repo, { getSession: async () => session } as never, provider));
  return { repo, intent, calls, provider, cancel, buyer, setState: (next: typeof state) => { state = next; } };
}

test("buyer editing cancels the frozen provider route, records the transition once and permits a new intent", async () => {
  const f = await setup();
  await f.cancel.execute("store", "session", f.buyer);
  assert.equal((await f.repo.getIntentById("store", f.intent.id))?.snapshot().status, "cancelled");
  assert.equal(f.calls[0]?.payment.providerAccountFingerprint, "frozen-account");
  assert.equal(f.calls[0]?.payment.provider, "asaas");
  assert.equal(f.repo.capturedEvents.length, 1);
  await f.cancel.execute("store", "session", f.buyer);
  assert.equal(f.calls.length, 1, "cancellation retry must not mutate a terminal payment");
  const next = PaymentIntentEntity.create({ merchantId: "store", sessionId: "session", method: "card",
    amountCents: 11099, currency: "BRL", idempotencyKey: "revised" });
  await f.repo.saveIntent({ intent: next });
  assert.equal((await f.repo.listForSession("store", "session")).length, 2);
});

for (const state of ["paid", "unknown"] as const) test(`unconfirmed cancellation (${state}) preserves the old payment and blocks a second charge`, async () => {
  const f = await setup(); f.setState(state);
  await assert.rejects(f.cancel.execute("store", "session", f.buyer), /cancellation_unconfirmed/);
  assert.equal((await f.repo.getIntentById("store", f.intent.id))?.snapshot().status, "requires_action");
  const next = PaymentIntentEntity.create({ merchantId: "store", sessionId: "session", method: "card",
    amountCents: 12099, currency: "BRL", idempotencyKey: "duplicate" });
  await assert.rejects(f.repo.saveIntent({ intent: next }));
});

test("approved payment and another merchant never reach provider cancellation", async () => {
  const f = await setup();
  await f.cancel.execute("other", "session", f.buyer); assert.equal(f.calls.length, 0);
  f.intent.markApproved({ providerPaymentId: "pay_test", approvedAmountCents: 12099 });
  await f.repo.saveIntent({ intent: f.intent });
  await assert.rejects(f.cancel.execute("store", "session", f.buyer), /cancellation_unconfirmed/);
  assert.equal(f.calls.length, 0);
});

test("a racing approval is not overwritten by a stale cancellation", async () => {
  const f = await setup();
  f.provider.cancelPendingPayment = async () => {
    const approved = (await f.repo.getIntentById("store", f.intent.id))!;
    approved.markApproved({ providerPaymentId: "pay_test", approvedAmountCents: 12099 });
    await f.repo.saveIntent({ intent: approved });
    return { state: "cancelled" };
  };
  await assert.rejects(f.cancel.execute("store", "session", f.buyer));
  assert.equal((await f.repo.getIntentById("store", f.intent.id))?.snapshot().status, "approved");
});
