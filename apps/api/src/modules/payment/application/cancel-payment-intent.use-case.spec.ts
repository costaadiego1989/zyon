import assert from "node:assert/strict";
import { test } from "node:test";
import { CancelPaymentIntentUseCase } from "./cancel-payment-intent.use-case.js";
import { PaymentIntentEntity } from "../domain/payment-intent.entity.js";
import { InMemoryPaymentRepository } from "../infrastructure/in-memory-payment.repository.js";
import type { PaymentProviderPort } from "../domain/ports/payment-provider.port.js";
import type { PendingPaymentCancellationResult } from "../domain/pending-payment-cancellation.js";

async function fixture() {
  const repository = new InMemoryPaymentRepository();
  const session = { merchantId: "merchant", sessionId: "session", globalUserId: "buyer", cart: { items: [] } };
  const buyer = { globalUserId: "buyer", customer: { email: "qa@example.test", email_verified: true as const } };
  const intent = PaymentIntentEntity.create({ merchantId: "merchant", sessionId: "session", idempotencyKey: "create", amountCents: 1947, currency: "BRL", method: "pix" });
  intent.prepareCreation({ provider: "mercadopago", providerAccountFingerprint: "original-account", merchantId: "merchant", sessionId: "session", intentId: intent.id, amountCents: 1947, currency: "BRL", method: "pix" });
  intent.claimCreation("create-token", new Date()); intent.markRequiresAction({ providerPaymentId: "1234" }); intent.completeCreation("create-token");
  intent.setBuyerFacingPayload({ qrCodeCopyPaste: "local-fixture-only" }); await repository.saveIntent({ intent });
  let reads = 0, mutations = 0;
  const provider: PaymentProviderPort = { createPayment: async () => assert.fail("cancellation cannot create payment"),
    readCancellationStatus: async () => { reads++; return { state: "pending" }; },
    cancelPendingPayment: async () => { mutations++; return { state: "cancelled" }; } };
  const checkout = { getSession: async (merchantId: string, sessionId: string) => merchantId === "merchant" && sessionId === "session" ? session : null };
  const request = { merchantId: "merchant", sessionId: "session", intentId: intent.id, idempotencyKey: "cancel-1", buyer };
  const make = () => new CancelPaymentIntentUseCase(repository, checkout as never, provider);
  return { repository, intent, request, session, buyer, provider, make, reads: () => reads, mutations: () => mutations,
    latest: async () => (await repository.getIntentById("merchant", intent.id))! };
}

// Simulate a historical ready journal already persisted by an older writer.
// Current admission rules still prohibit two active payments.
function seedHistoricalIntent(repository: InMemoryPaymentRepository, intent: PaymentIntentEntity) {
  const snapshot = intent.snapshot(); snapshot.version = 1; intent.persisted(1);
  const stored = PaymentIntentEntity.rehydrate(snapshot);
  (repository as any).byIdempotency.set(`${snapshot.merchantId}::${snapshot.sessionId}::${snapshot.idempotencyKey}`, stored);
  (repository as any).byIntentId.set(snapshot.id, stored);
}

test("known pending charge cancels once, atomically records status/outbox and removes payable credentials", async () => {
  const f = await fixture(), result = await f.make().execute(f.request);
  assert.equal(result.cancellation, "cancelled"); assert.equal(result.status, "cancelled"); assert.equal(f.mutations(), 1);
  const latest = (await f.latest()).snapshot();
  assert.equal(latest.creation?.cancellation?.state, "cancelled"); assert.ok(latest.creation?.cancellation?.mutationAttemptedAt);
  assert.equal(latest.buyerFacing, undefined); assert.equal(f.repository.capturedEvents.length, 1);
  assert.equal((await f.make().execute({ ...f.request, idempotencyKey: "different-client-key" })).cancellation, "cancelled");
  assert.equal(f.mutations(), 1); assert.equal(f.repository.capturedEvents.length, 1);
});

test("tenant, session and authenticated buyer must match before any PSP read or mutation", async () => {
  for (const patch of [{ merchantId: "other" }, { sessionId: "other" }, { buyer: { globalUserId: "other", customer: { email: "other@example.test", email_verified: true as const } } }, { intentId: "foreign" }]) {
    const f = await fixture(); await assert.rejects(f.make().execute({ ...f.request, ...patch })); assert.equal(f.reads(), 0); assert.equal(f.mutations(), 0);
  }
});

test("concurrent buyers commands claim a single durable operation", async () => {
  const f = await fixture(); const results = await Promise.all([f.make().execute(f.request), f.make().execute(f.request)]);
  assert.equal(f.mutations(), 1); assert.ok(results.some(result => result.cancellation === "cancelled"));
  assert.equal((await f.latest()).snapshot().status, "cancelled");
});

test("timeout after remote submission survives service restart; retry reads only and never resends cancellation", async () => {
  const f = await fixture(); let writes = 0;
  f.provider.cancelPendingPayment = async () => { writes++; throw new Error("timeout"); };
  const first = await f.make().execute(f.request); assert.equal(first.cancellation, "pending");
  const saved = (await f.latest()).snapshot(); assert.equal(saved.status, "requires_action"); assert.equal(saved.creation?.cancellation?.state, "uncertain");
  assert.ok(saved.creation?.cancellation?.mutationAttemptedAt);
  f.provider.readCancellationStatus = async () => ({ state: "cancelled" });
  assert.equal((await f.make().execute(f.request)).cancellation, "cancelled"); assert.equal(writes, 1);
});

test("404/unknown read never proves cancellation; pre-submission retry may make its first mutation after a valid read", async () => {
  const f = await fixture(); f.provider.readCancellationStatus = async () => { throw new Error("404"); };
  assert.equal((await f.make().execute(f.request)).cancellation, "pending"); assert.equal(f.mutations(), 0);
  assert.equal((await f.latest()).snapshot().creation?.cancellation?.mutationAttemptedAt, undefined);
  f.provider.readCancellationStatus = async () => ({ state: "pending" });
  assert.equal((await f.make().execute(f.request)).cancellation, "cancelled"); assert.equal(f.mutations(), 1);
});

test("an already-submitted cancellation still pending at PSP is not repeated and blocks a fresh creation", async () => {
  const f = await fixture(); f.provider.cancelPendingPayment = async () => ({ state: "unknown" });
  await f.make().execute(f.request); assert.equal((await f.make().execute(f.request)).cancellation, "pending");
  const another = PaymentIntentEntity.create({ merchantId: "merchant", sessionId: "session", idempotencyKey: "new-create", amountCents: 1947, currency: "BRL", method: "pix" });
  await assert.rejects(f.repository.saveIntent({ intent: another }), /payment_cancellation_pending/);
  assert.equal((await f.latest()).snapshot().status, "requires_action");
});

test("webhook approval during authoritative read wins before the remote cancellation", async () => {
  const f = await fixture(); f.provider.readCancellationStatus = async () => {
    const paid = await f.latest(); paid.markApproved({ providerPaymentId: "1234", approvedAmountCents: 1947 }); await f.repository.saveIntent({ intent: paid });
    return { state: "pending" };
  };
  const result = await f.make().execute(f.request); assert.equal(result.status, "approved"); assert.equal(result.cancellation, "not_pending"); assert.equal(f.mutations(), 0);
});

test("webhook approval during PSP cancellation is never overwritten by a late cancellation result", async () => {
  const f = await fixture(); f.provider.cancelPendingPayment = async () => {
    const paid = await f.latest(); paid.markApproved({ providerPaymentId: "1234", approvedAmountCents: 1947 }); await f.repository.saveIntent({ intent: paid });
    return { state: "cancelled" };
  };
  const result = await f.make().execute(f.request); assert.equal(result.status, "approved"); assert.equal(result.cancellation, "not_pending");
  assert.equal((await f.latest()).snapshot().approvedAmountCents, 1947); assert.equal(f.repository.capturedEvents.length, 0);
});

test("CAS conflict caused by an approved webhook at final save preserves the approved status", async () => {
  const f = await fixture(), save = f.repository.saveIntentWithOutbox.bind(f.repository); let race = true;
  f.repository.saveIntentWithOutbox = async (input, event) => {
    if (race) { race = false; const paid = await f.latest(); paid.markApproved({ providerPaymentId: "1234", approvedAmountCents: 1947 }); await f.repository.saveIntent({ intent: paid }); }
    await save(input, event);
  };
  const result = await f.make().execute(f.request); assert.equal(result.cancellation, "not_pending"); assert.equal(result.status, "approved");
});

test("remote paid/unsupported states do not mutate or refund and do not fabricate local approval", async () => {
  for (const state of ["paid", "unsupported", "unavailable"] as const) {
    const f = await fixture(); f.provider.readCancellationStatus = async (): Promise<PendingPaymentCancellationResult> => ({ state });
    const result = await f.make().execute(f.request); assert.equal(result.cancellation, state === "unsupported" ? "unsupported" : "not_pending");
    assert.equal(result.status, "requires_action"); assert.equal(f.mutations(), 0); assert.equal(f.repository.capturedEvents.length, 0);
  }
});

test("legacy without frozen route and marketplace cannot adopt a provider or cancel unrelated charges", async () => {
  const f = await fixture(); const snapshot = (await f.latest()).snapshot(); snapshot.creation = undefined;
  const legacy = PaymentIntentEntity.rehydrate(snapshot);
  const service = new CancelPaymentIntentUseCase({ getIntentById: async () => legacy } as never, { getSession: async () => f.session } as never, f.provider);
  assert.equal((await service.execute(f.request)).cancellation, "unsupported"); assert.equal(f.reads(), 0);
  Object.assign(f.session, { crossStoreItems: [{}] }); assert.equal((await f.make().execute(f.request)).cancellation, "unsupported"); assert.equal(f.mutations(), 0);
});

test("marker identity and attempted mutation cannot be erased by a stale writer", async () => {
  const f = await fixture(); f.provider.cancelPendingPayment = async () => ({ state: "unknown" }); await f.make().execute(f.request);
  const snapshot = (await f.latest()).snapshot(); snapshot.creation!.cancellation!.mutationAttemptedAt = undefined;
  await assert.rejects(f.repository.saveIntent({ intent: PaymentIntentEntity.rehydrate(snapshot) }), /payment_cancellation_immutable_fields_changed/);
});

test("a ready creation admitted before cancellation cannot acquire its first-send lease afterwards", async () => {
  const f = await fixture(), another = PaymentIntentEntity.create({ merchantId: "merchant", sessionId: "session", idempotencyKey: "new-create", amountCents: 1947, currency: "BRL", method: "pix" });
  another.prepareCreation({ ...f.intent.snapshot().creation!.input, intentId: another.id }); seedHistoricalIntent(f.repository, another);
  f.provider.readCancellationStatus = async () => ({ state: "unknown" }); await f.make().execute(f.request);
  another.claimCreation("lease", new Date()); await assert.rejects(f.repository.saveIntent({ intent: another }), /payment_cancellation_pending/);
});

test("cancellation cannot begin across another creation already admitted for remote submission", async () => {
  const f = await fixture(), another = PaymentIntentEntity.create({ merchantId: "merchant", sessionId: "session", idempotencyKey: "new-create", amountCents: 1947, currency: "BRL", method: "pix" });
  another.prepareCreation({ ...f.intent.snapshot().creation!.input, intentId: another.id }); another.claimCreation("lease", new Date()); seedHistoricalIntent(f.repository, another);
  await assert.rejects(f.make().execute(f.request), /payment_creation_in_progress/); assert.equal(f.reads(), 0); assert.equal(f.mutations(), 0);
});
