import test from "node:test";
import assert from "node:assert/strict";
import { CancelCheckoutPaymentUseCase } from "./cancel-checkout-payment.use-case.js";
import { PaymentIntentEntity } from "../domain/payment-intent.entity.js";
import { InMemoryPaymentRepository } from "../infrastructure/in-memory-payment.repository.js";
import { CancelPaymentIntentUseCase } from "./cancel-payment-intent.use-case.js";
import type { PendingPaymentCancellationInput } from "../domain/pending-payment-cancellation.js";

const buyer = { globalUserId: "buyer", customer: { email: "qa@example.invalid", email_verified: true as const } };

async function setup() {
  const repo = new InMemoryPaymentRepository();
  const intent = PaymentIntentEntity.create({ merchantId: "store", sessionId: "session", method: "pix",
    amountCents: 12099, currency: "BRL", idempotencyKey: "first" });
  intent.prepareCreation({ merchantId: "store", sessionId: "session", intentId: intent.id, method: "pix",
    amountCents: 12099, currency: "BRL", provider: "asaas", providerAccountFingerprint: "frozen-account",
    settlementMode: "immediate_split" });
  intent.claimCreation("creation-lease", new Date());
  intent.completeCreation("creation-lease");
  intent.markRequiresAction({ providerPaymentId: "pay_test" });
  await repo.saveIntent({ intent });
  const calls: PendingPaymentCancellationInput[] = [];
  let state: "cancelled" | "paid" | "unknown" = "cancelled";
  const provider = { createPayment: async () => { throw new Error("must not charge"); },
    readCancellationStatus: async () => ({ state: "pending" as const }),
    cancelPendingPayment: async (input: PendingPaymentCancellationInput) => { calls.push(input); return { state }; } };
  const checkout = { getSession: async () => ({ merchantId: "store", sessionId: "session", globalUserId: "buyer", cart: { items: [] } }) };
  const cancel = new CancelCheckoutPaymentUseCase(repo, new CancelPaymentIntentUseCase(repo, checkout as any, provider));
  return { repo, intent, calls, provider, cancel, setState: (next: typeof state) => { state = next; } };
}

test("buyer editing cancels the frozen provider route, records the transition once and permits a new intent", async () => {
  const f = await setup();
  await f.cancel.execute("store", "session", buyer);
  assert.equal((await f.repo.getIntentById("store", f.intent.id))?.snapshot().status, "cancelled");
  assert.equal(f.calls[0]?.payment.providerAccountFingerprint, "frozen-account");
  assert.equal(f.calls[0]?.payment.provider, "asaas");
  assert.equal(f.repo.capturedEvents.length, 1);
  await f.cancel.execute("store", "session", buyer);
  assert.equal(f.calls.length, 1, "cancellation retry must not mutate a terminal payment");
  const next = PaymentIntentEntity.create({ merchantId: "store", sessionId: "session", method: "card",
    amountCents: 11099, currency: "BRL", idempotencyKey: "revised" });
  await f.repo.saveIntent({ intent: next });
  assert.equal((await f.repo.listForSession("store", "session")).length, 2);
});

for (const state of ["paid", "unknown"] as const) test(`unconfirmed cancellation (${state}) preserves the old payment and rejects editing`, async () => {
  const f = await setup(); f.setState(state);
  await assert.rejects(f.cancel.execute("store", "session", buyer), /cancellation_unconfirmed/);
  assert.equal((await f.repo.getIntentById("store", f.intent.id))?.snapshot().status, "requires_action");
  assert.equal((await f.repo.listForSession("store", "session")).length, 1);
});

test("approved payment and another merchant never reach provider cancellation", async () => {
  const f = await setup();
  await f.cancel.execute("other", "session", buyer); assert.equal(f.calls.length, 0);
  f.intent.markApproved({ providerPaymentId: "pay_test", approvedAmountCents: 12099 });
  await f.repo.saveIntent({ intent: f.intent });
  await assert.rejects(f.cancel.execute("store", "session", buyer), /cancellation_unconfirmed/);
  assert.equal(f.calls.length, 0);
});

test("a racing approval is not overwritten by a stale cancellation", async () => {
  const f = await setup();
  f.provider.cancelPendingPayment = async () => {
    const latest = (await f.repo.getIntentById("store", f.intent.id))!;
    latest.markApproved({ providerPaymentId: "pay_test", approvedAmountCents: 12099 });
    await f.repo.saveIntent({ intent: latest });
    return { state: "cancelled" };
  };
  await assert.rejects(f.cancel.execute("store", "session", buyer));
  assert.equal((await f.repo.getIntentById("store", f.intent.id))?.snapshot().status, "approved");
});
