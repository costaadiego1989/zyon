import test from "node:test";
import assert from "node:assert/strict";
import { CancelCheckoutPaymentUseCase } from "./cancel-checkout-payment.use-case.js";
import { PaymentIntentEntity } from "../domain/payment-intent.entity.js";
import { InMemoryPaymentRepository } from "../infrastructure/in-memory-payment.repository.js";
import type { FetchPaymentStatusInput } from "../domain/ports/payment-provider.port.js";

async function setup() {
  const repo = new InMemoryPaymentRepository();
  const intent = PaymentIntentEntity.create({ merchantId: "store", sessionId: "session", method: "pix",
    amountCents: 12099, currency: "BRL", idempotencyKey: "first" });
  intent.prepareCreation({ merchantId: "store", sessionId: "session", intentId: intent.id, method: "pix",
    amountCents: 12099, currency: "BRL", provider: "asaas", providerAccountFingerprint: "frozen-account",
    settlementMode: "immediate_split" });
  intent.markRequiresAction({ providerPaymentId: "pay_test" });
  await repo.saveIntent({ intent });
  const calls: FetchPaymentStatusInput[] = [];
  let state: "cancelled" | "blocked" | "unknown" = "cancelled";
  const provider = { createPayment: async () => { throw new Error("must not charge"); },
    cancelPayment: async (input: FetchPaymentStatusInput) => { calls.push(input); return { state }; } };
  const cancel = new CancelCheckoutPaymentUseCase(repo, provider);
  return { repo, intent, calls, provider, cancel, setState: (next: typeof state) => { state = next; } };
}

test("buyer editing cancels the frozen provider route, records the transition once and permits a new intent", async () => {
  const f = await setup();
  await f.cancel.execute("store", "session");
  assert.equal((await f.repo.getIntentById("store", f.intent.id))?.snapshot().status, "cancelled");
  assert.equal(f.calls[0]?.providerAccountFingerprint, "frozen-account");
  assert.equal(f.calls[0]?.provider, "asaas");
  assert.equal(f.repo.capturedEvents.length, 1);
  await f.cancel.execute("store", "session");
  assert.equal(f.calls.length, 1, "cancellation retry must not mutate a terminal payment");
  const next = PaymentIntentEntity.create({ merchantId: "store", sessionId: "session", method: "card",
    amountCents: 11099, currency: "BRL", idempotencyKey: "revised" });
  await f.repo.saveIntent({ intent: next });
  assert.equal((await f.repo.listForSession("store", "session")).length, 2);
});

for (const state of ["blocked", "unknown"] as const) test(`unconfirmed cancellation (${state}) preserves the old payment and blocks a second charge`, async () => {
  const f = await setup(); f.setState(state);
  await assert.rejects(f.cancel.execute("store", "session"), /cancellation_unconfirmed/);
  assert.equal((await f.repo.getIntentById("store", f.intent.id))?.snapshot().status, "requires_action");
  const next = PaymentIntentEntity.create({ merchantId: "store", sessionId: "session", method: "card",
    amountCents: 12099, currency: "BRL", idempotencyKey: "duplicate" });
  await assert.rejects(f.repo.saveIntent({ intent: next }));
});

test("approved payment and another merchant never reach provider cancellation", async () => {
  const f = await setup();
  await f.cancel.execute("other", "session"); assert.equal(f.calls.length, 0);
  f.intent.markApproved({ providerPaymentId: "pay_test", approvedAmountCents: 12099 });
  await f.repo.saveIntent({ intent: f.intent });
  await assert.rejects(f.cancel.execute("store", "session"), /not_editable/);
  assert.equal(f.calls.length, 0);
});

test("a racing approval is not overwritten by a stale cancellation", async () => {
  const f = await setup();
  f.provider.cancelPayment = async () => {
    f.intent.markApproved({ providerPaymentId: "pay_test", approvedAmountCents: 12099 });
    await f.repo.saveIntent({ intent: f.intent });
    return { state: "cancelled" };
  };
  await assert.rejects(f.cancel.execute("store", "session"));
  assert.equal((await f.repo.getIntentById("store", f.intent.id))?.snapshot().status, "approved");
});
