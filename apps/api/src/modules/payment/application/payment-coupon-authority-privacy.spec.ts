import assert from "node:assert/strict";
import test from "node:test";
import { PaymentIntentEntity, type PaymentIntentSnapshot } from "../domain/payment-intent.entity.js";
import type { CreateProviderPaymentInput, PaymentProviderPort } from "../domain/ports/payment-provider.port.js";
import { InMemoryPaymentRepository } from "../infrastructure/in-memory-payment.repository.js";
import { GetPaymentIntentStatusUseCase } from "./get-payment-intent-status.use-case.js";
import { ResumePaymentCreationService } from "./resume-payment-creation.service.js";

const CANARY = "PRIVATE_COUPON_AUTHORITY_DISPATCH_CANARY";
const merchantId = "synthetic-privacy-merchant", sessionId = "synthetic-privacy-checkout";
const authority = () => ({ version: 1 as const, bindingId: "11111111-1111-4111-8111-111111111111",
  merchantId, cartId: "synthetic-private-cart", checkoutSessionId: sessionId,
  buyerId: "synthetic-private-buyer", reservationBuyerId: null, redemptionId: CANARY,
  couponId: "synthetic-private-coupon", discountCents: 137, basisHash: "ab".repeat(32) });

/** Synthetic stored journal only. No issuer, admission fence, SQL or PSP proof. */
function journal() {
  const plain = PaymentIntentEntity.create({ merchantId, sessionId, idempotencyKey: "synthetic-privacy-key",
    amountCents: 863, currency: "BRL", method: "pix" });
  plain.prepareCreation({ merchantId, sessionId, intentId: plain.id, provider: "asaas",
    amountCents: 863, currency: "BRL", method: "pix", asaasCustomerId: "synthetic-customer",
    providerIdempotencyKey: "synthetic-stable-key" });
  const stored = plain.snapshot();
  assert.ok(stored.creation);
  stored.creation.couponAuthority = authority();
  return PaymentIntentEntity.rehydrate(stored);
}

function privateFieldsAbsent(value: unknown) {
  const serialized = JSON.stringify(value);
  assert.ok(typeof serialized === "string");
  for (const marker of [CANARY, "couponAuthority", "coupon_authority", "_storefrontCouponBinding",
    authority().bindingId, authority().basisHash, authority().cartId, authority().buyerId, authority().couponId]) {
    assert.equal(serialized.includes(marker), false, `private marker leaked: ${marker}`);
  }
}

function providerSpy(expected: CreateProviderPaymentInput, providerPaymentId = "synthetic-receipt") {
  const calls: Array<{ operation: "create" | "recover"; input: CreateProviderPaymentInput; firstAttemptAt?: string }> = [];
  const inspect = (operation: "create" | "recover", input: CreateProviderPaymentInput, firstAttemptAt?: string) => {
    assert.deepEqual(input, expected);
    privateFieldsAbsent(input);
    calls.push({ operation, input: structuredClone(input), firstAttemptAt });
    return { providerPaymentId, status: "requires_action" as const,
      buyerFacingPayload: { qrCodeCopyPaste: "synthetic-pix", invoiceUrl: "https://provider.invalid/synthetic" } };
  };
  const provider: PaymentProviderPort = {
    createPayment: async input => inspect("create", input),
    recoverPayment: async (input, firstAttemptAt) => inspect("recover", input, firstAttemptAt),
  };
  return { provider, calls };
}

function inputOf(intent: PaymentIntentEntity) {
  const creation = intent.snapshot().creation;
  assert.ok(creation);
  return creation.input;
}

async function assertStoredAuthority(repository: InMemoryPaymentRepository, id: string, expected: PaymentIntentSnapshot) {
  const saved = await repository.getIntentById(merchantId, id);
  assert.ok(saved);
  assert.deepEqual(saved.snapshot().creation?.couponAuthority, authority());
  assert.deepEqual(saved.snapshot().creation?.input, expected.creation?.input);
  for (const event of repository.capturedEvents) privateFieldsAbsent(event);
  return saved.snapshot();
}

test("real resume create sends only the public provider input and retains the stored sibling", async () => {
  const repository = new InMemoryPaymentRepository(), intent = journal(), before = intent.snapshot();
  await repository.saveIntent({ intent });
  const spy = providerSpy(inputOf(intent));
  const service = new ResumePaymentCreationService(repository, spy.provider);
  const result = await service.execute(intent);
  assert.deepEqual(spy.calls.map(call => call.operation), ["create"]);
  assert.equal(result.creation?.state, "complete");
  assert.deepEqual(result.creation?.couponAuthority, authority());
  const stored = await assertStoredAuthority(repository, intent.id, before);
  assert.ok(stored.creation?.firstAttemptAt);
  await service.execute(PaymentIntentEntity.rehydrate(stored));
  assert.equal(spy.calls.length, 1, "completed replay must not dispatch again");
});

for (const state of ["uncertain", "expired-in-flight"] as const) {
  test(`real resume ${state} recovery keeps the original input, generation and first attempt private`, async () => {
    const repository = new InMemoryPaymentRepository(), intent = journal();
    assert.equal(intent.claimCreation("synthetic-first-lease", new Date(0)), "create");
    if (state === "uncertain") intent.markCreationUncertain("synthetic-first-lease", "synthetic_ack_unknown");
    const before = intent.snapshot();
    await repository.saveIntent({ intent });
    const spy = providerSpy(inputOf(intent));
    const result = await new ResumePaymentCreationService(repository, spy.provider).execute(intent);
    assert.deepEqual(spy.calls.map(call => call.operation), ["recover"]);
    assert.equal(spy.calls[0].firstAttemptAt, new Date(0).toISOString());
    assert.equal(result.creation?.firstAttemptAt, before.creation?.firstAttemptAt);
    assert.deepEqual(result.creation?.couponAuthority, authority());
    await assertStoredAuthority(repository, intent.id, before);
  });
}

test("real Pix presentation repair receives only the frozen public input, not coupon authority", async () => {
  const repository = new InMemoryPaymentRepository(), intent = journal();
  intent.claimCreation("synthetic-lease", new Date(0));
  intent.completeCreation("synthetic-lease");
  intent.markRequiresAction({ providerPaymentId: "synthetic-existing-pix" });
  intent.setBuyerFacingPayload({});
  const before = intent.snapshot();
  await repository.saveIntent({ intent });
  const spy = providerSpy(inputOf(intent), "synthetic-existing-pix");
  const result = await new ResumePaymentCreationService(repository, spy.provider).execute(intent);
  assert.deepEqual(spy.calls.map(call => call.operation), ["recover"]);
  assert.equal(spy.calls[0].firstAttemptAt, new Date(0).toISOString());
  assert.equal(result.providerPaymentId, before.providerPaymentId);
  assert.equal(result.buyerFacing?.qrCodeCopyPaste, "synthetic-pix");
  await assertStoredAuthority(repository, intent.id, before);
  assert.equal(repository.capturedEvents.length, 0, "presentation repair is not a new payment event");
});

test("approved journal replay preserves private authority without calling the provider", async () => {
  const repository = new InMemoryPaymentRepository(), intent = journal();
  intent.claimCreation("synthetic-lease", new Date(0)); intent.completeCreation("synthetic-lease");
  intent.markRequiresAction({ providerPaymentId: "synthetic-receipt" });
  intent.markApproved({ providerPaymentId: "synthetic-receipt", approvedAmountCents: 863 });
  await repository.saveIntent({ intent });
  const spy = providerSpy(inputOf(intent));
  const result = await new ResumePaymentCreationService(repository, spy.provider).execute(intent);
  assert.deepEqual(result, intent.snapshot());
  assert.deepEqual(spy.calls, []);
  assert.deepEqual(result.creation?.couponAuthority, authority());
});

test("public status allowlist omits the entire private journal and provider input", async () => {
  const repository = new InMemoryPaymentRepository(), intent = journal();
  intent.claimCreation("synthetic-lease", new Date(0)); intent.completeCreation("synthetic-lease");
  intent.markRequiresAction({ providerPaymentId: "synthetic-receipt" });
  intent.setBuyerFacingPayload({ invoiceUrl: "https://provider.invalid/synthetic" });
  await repository.saveIntent({ intent });
  const result = await new GetPaymentIntentStatusUseCase(repository).execute({
    merchant_id: merchantId, session_id: sessionId, intent_id: intent.id });
  assert.deepEqual(result, { intent_id: intent.id, status: "requires_action", amount_cents: 863,
    approved_amount_cents: undefined, currency: "BRL", method: "pix", order_id: "synthetic-receipt",
    provider_payment_id: "synthetic-receipt", receipt_url: "https://provider.invalid/synthetic" });
  privateFieldsAbsent(result);
  for (const key of ["creation", "input", "version", "asaasCustomerId", "providerIdempotencyKey"]) {
    assert.equal(Object.hasOwn(result, key), false);
  }
});

test("public status tenant/session refusals never expose the stored authority", async () => {
  const repository = new InMemoryPaymentRepository(), intent = journal();
  await repository.saveIntent({ intent });
  const service = new GetPaymentIntentStatusUseCase(repository);
  for (const scope of [{ merchant_id: "synthetic-foreign-merchant", session_id: sessionId },
    { merchant_id: merchantId, session_id: "synthetic-foreign-checkout" }]) {
    await assert.rejects(service.execute({ ...scope, intent_id: intent.id }), error => {
      assert.ok(error instanceof Error);
      assert.equal(error.message, "payment_intent_not_found");
      privateFieldsAbsent({ ...error, message: error.message });
      return true;
    });
  }
});
