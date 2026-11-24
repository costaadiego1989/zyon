import assert from "node:assert/strict";
import test from "node:test";
import { ConflictException } from "@nestjs/common";
import { PaymentIntentConflictError } from "../domain/payment-persistence.js";
import { PaymentIntentEntity } from "../domain/payment-intent.entity.js";
import { InMemoryPaymentRepository } from "./in-memory-payment.repository.js";
import { CancelCheckoutPaymentUseCase } from "../application/cancel-checkout-payment.use-case.js";
import { CancelPaymentIntentUseCase } from "../application/cancel-payment-intent.use-case.js";
import { ownedAsaasCancellation } from "../../../../tests/asaas-owned-cancellation.fixture.js";

const buyer = { globalUserId: "buyer", customer: { email: "buyer@example.test", email_verified: true as const } };
async function fixture(method: "card" | "pix" = "card", rotated = false) {
  const repo = new InMemoryPaymentRepository(), intent = PaymentIntentEntity.create({ merchantId: "store", sessionId: "session", method, amountCents: 5000, currency: "BRL", idempotencyKey: "original" });
  const transport = ownedAsaasCancellation({ merchantId: "store", sessionId: "session", intentId: intent.id }, method, rotated);
  intent.prepareCreation(transport.input); intent.claimCreation("owned-create", new Date()); intent.completeCreation("owned-create"); intent.markRequiresAction({ providerPaymentId: transport.providerId }); await repo.saveIntent({ intent });
  const checkout = { getSession: async (merchantId: string, sessionId: string) => merchantId === "store" && sessionId === "session" ? { merchantId, sessionId, globalUserId: "buyer", cart: { items: [] } } : undefined };
  const cancellation = new CancelPaymentIntentUseCase(repo, checkout as never, transport.router);
  const useCase = new CancelCheckoutPaymentUseCase(repo, cancellation);
  transport.state.beforeCall = async () => { if (transport.calls.at(-1)?.method === "DELETE") {
    const current = (await repo.getIntentById("store", intent.id))!.snapshot(); assert.ok(current.creation?.cancellation?.mutationAttemptedAt, "durable mutation marker precedes DELETE"); } };
  const cancel = () => useCase.execute("store", "session", buyer);
  const current = async () => (await repo.getIntentById("store", intent.id))!.snapshot();
  const next = () => PaymentIntentEntity.create({ merchantId: "store", sessionId: "session", method: method === "card" ? "pix" : "card", amountCents: 5000, currency: "BRL", idempotencyKey: "replacement" });
  const noReplacement = async () => { await assert.rejects(repo.saveIntent({ intent: next() }), error => error instanceof PaymentIntentConflictError || error instanceof ConflictException && error.message === "payment_cancellation_pending"); assert.equal((await repo.listForSession("store", "session")).length, 1); };
  return { repo, intent, transport, useCase, cancellation, cancel, current, next, noReplacement };
}
const refusal = async (f: Awaited<ReturnType<typeof fixture>>) => {
  await assert.rejects(f.cancel(), /checkout_payment_cancellation_unconfirmed/); assert.equal((await f.current()).status, "requires_action"); await f.noReplacement();
};

test("S5 strict Asaas cancellation permits duplex single-charge switching only after original charge proof", async t => {
  for (const method of ["card", "pix"] as const) await t.test(method + " cancellation is fully proved before another method may be saved; replay does not DELETE again", async () => {
    const f = await fixture(method); f.transport.success(); await f.cancel();
    assert.equal((await f.current()).status, "cancelled"); assert.deepEqual(f.transport.calls.map(call => call.method), ["GET", "GET", "DELETE", "GET"]);
    assert.equal(f.repo.capturedEvents.length, 1); await f.cancel(); assert.equal(f.transport.calls.length, 4); assert.equal(f.repo.capturedEvents.length, 1);
    await f.repo.saveIntent({ intent: f.next() }); assert.equal((await f.repo.listForSession("store", "session")).length, 2);
  });
  for (const status of ["CONFIRMED", "AUTHORIZED", "AWAITING_RISK_ANALYSIS", "REFUND_REQUESTED"]) await t.test("card status " + status + " never authorizes DELETE or a replacement", async () => {
    const f = await fixture(); f.transport.enqueue(f.transport.body({ status, deleted: true })); await refusal(f); assert.deepEqual(f.transport.calls.map(call => call.method), ["GET"]);
  });
  for (const field of ["subscription", "installment"]) await t.test("linked card " + field + " remains unsupported without terminating the source", async () => {
    const f = await fixture(); f.transport.enqueue(f.transport.body({ [field]: "foreign-source" })); await refusal(f); assert.deepEqual(f.transport.calls.map(call => call.method), ["GET"]);
  });
  const bad: Array<[string, unknown]> = [["id", "foreign-charge"], ["externalReference", "foreign-intent"], ["customer", "foreign-customer"], ["billingType", "PIX"], ["value", 49], ["currency", "USD"]];
  for (const [field, value] of bad) await t.test("wrong card " + field + " cannot pass original identity/value proof", async () => {
    const f = await fixture(); f.transport.enqueue(f.transport.body({ [field]: value })); await refusal(f); assert.deepEqual(f.transport.calls.map(call => call.method), ["GET"]);
  });
  await t.test("provider paid state observed after DELETE cannot be mistaken for unpaid removal", async () => {
    const f = await fixture(); f.transport.enqueue(f.transport.body()); f.transport.enqueue(f.transport.body()); f.transport.enqueue({ id: f.transport.providerId, deleted: true });
    f.transport.enqueue(f.transport.body({ deleted: true, status: "RECEIVED" })); await refusal(f); assert.equal(f.transport.calls.filter(call => call.method === "DELETE").length, 1);
  });
  await t.test("DELETE failure is uncertain and a retry reads only; replacement stays blocked", async () => {
    const f = await fixture(); f.transport.enqueue(f.transport.body()); f.transport.enqueue(f.transport.body()); f.transport.enqueue({ errors: [] }, 500); await refusal(f);
    const marker = (await f.current()).creation!.cancellation!.mutationAttemptedAt; assert.ok(marker);
    f.transport.enqueue(f.transport.body()); await refusal(f); assert.equal(f.transport.calls.filter(call => call.method === "DELETE").length, 1);
    assert.equal((await f.current()).creation!.cancellation!.mutationAttemptedAt, marker);
  });
  await t.test("wrong DELETE acknowledgement id is unknown even with deleted:true", async () => {
    const f = await fixture(); f.transport.enqueue(f.transport.body()); f.transport.enqueue(f.transport.body()); f.transport.enqueue({ id: "foreign", deleted: true }); await refusal(f); assert.equal(f.transport.calls.length, 3);
  });
  await t.test("a rotated account fingerprint refuses before provider I/O and does not reroute", async () => {
    const f = await fixture("card", true); await refusal(f); assert.equal(f.transport.calls.length, 0);
  });
  await t.test("foreign buyer cannot record cancellation or reach the provider", async () => {
    const f = await fixture(), before = await f.current(); await assert.rejects(f.useCase.execute("store", "session", { ...buyer, globalUserId: "foreign" }), /payment_cancellation_buyer_mismatch/);
    assert.deepEqual(await f.current(), before); assert.equal(f.transport.calls.length, 0); await f.noReplacement();
  });
  await t.test("foreign tenant or intent reference is rejected before mutation and provider I/O", async () => {
    const f = await fixture(), before = await f.current();
    await assert.rejects(f.cancellation.execute({ merchantId: "foreign", sessionId: "session", intentId: f.intent.id, idempotencyKey: "foreign", buyer }), /payment_cancellation_buyer_mismatch/);
    await assert.rejects(f.cancellation.execute({ merchantId: "store", sessionId: "session", intentId: "foreign_intent", idempotencyKey: "foreign", buyer }), /payment_intent_not_found/);
    assert.deepEqual(await f.current(), before); assert.equal(f.transport.calls.length, 0); await f.noReplacement();
  });
  await t.test("a real persisted approval during the initial provider read wins before DELETE", async () => {
    const f = await fixture(); f.transport.enqueue(f.transport.body()); f.transport.state.beforeCall = async () => {
      if (f.transport.calls.length === 1) { const current = (await f.repo.getIntentById("store", f.intent.id))!;
        current.markApproved({ providerPaymentId: f.transport.providerId, approvedAmountCents: 5000 }); await f.repo.saveIntent({ intent: current }); }
    };
    await assert.rejects(f.cancel(), /checkout_payment_cancellation_unconfirmed/); assert.equal((await f.current()).status, "approved");
    assert.deepEqual(f.transport.calls.map(call => call.method), ["GET"]); await f.noReplacement();
  });
  await t.test("missing deleted proof stays unknown instead of assuming a pending charge was removed", async () => {
    const f = await fixture(); f.transport.enqueue(f.transport.body({ deleted: undefined })); await refusal(f); assert.equal(f.transport.calls.length, 1);
  });
});
