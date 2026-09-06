import "reflect-metadata";
import test from "node:test";
import assert from "node:assert/strict";
import { PaymentIntentEntity } from "../domain/payment-intent.entity.js";
import { InMemoryPaymentRepository } from "../infrastructure/in-memory-payment.repository.js";
import { AsaasPaymentAdapter } from "../infrastructure/asaas-payment.adapter.js";
import { StripePaymentAdapter } from "../infrastructure/stripe-payment.adapter.js";
import { ResumePaymentCreationService } from "../application/resume-payment-creation.service.js";
import { PaymentDispatchService } from "../application/services/payment-dispatch.service.js";
import { ReconcilePaymentIntentsUseCase } from "../application/reconcile-payment-intents.use-case.js";
import { CreatePaymentIntentUseCase } from "../application/create-payment-intent.use-case.js";
import type { CreateProviderPaymentInput, PaymentProviderPort } from "../domain/ports/payment-provider.port.js";
import { InMemoryCheckoutRepository } from "../../checkout/infrastructure/repositories/in-memory-checkout.repository.js";
import { checkoutSession } from "../../checkout/__tests__/checkout-test-fixtures.js";
import type { CheckoutPaymentApprovedInput, CheckoutPaymentPort } from "../domain/ports/checkout-payment.port.js";
import { InMemoryDomainEventBus } from "../../../shared/events/in-memory-domain-event-bus.js";

function prepared() {
  const intent = PaymentIntentEntity.create({ merchantId: "merchant_recovery", sessionId: "session_recovery", idempotencyKey: "same-key", amountCents: 1099, currency: "BRL", method: "pix" });
  intent.prepareCreation({ merchantId: "merchant_recovery", sessionId: "session_recovery", intentId: intent.id, amountCents: 1099, currency: "BRL", method: "pix", asaasCustomerId: "cus_owned", providerIdempotencyKey: "stable-key", provider: "asaas" });
  return intent;
}

function asaasMock(intentId: string, options: { loseResponse?: boolean; empty?: boolean; duplicate?: boolean; mismatch?: boolean } = {}) {
  let posts = 0;
  const requests: Array<{ url: string; method: string }> = [];
  const payment = { id: "pay_unique", externalReference: intentId, customer: "cus_owned", value: options.mismatch ? 999 : 10.99, billingType: "PIX", status: "PENDING", invoiceUrl: "https://provider.invalid/invoice" };
  const fetchMock = (async (raw, init) => {
    const url = String(raw); const method = init?.method ?? "GET";
    requests.push({ url, method });
    assert.equal(init?.redirect, "error"); assert.ok(init?.signal);
    if (method === "POST") {
      posts++;
      const input = JSON.parse(String(init?.body));
      assert.equal(input.externalReference, intentId);
      if (options.loseResponse) throw new Error("network failed after accepting private payment");
      return Response.json(payment);
    }
    if (url.includes("pixQrCode")) return Response.json({ payload: "pix_usable", encodedImage: "png", expirationDate: "2026-09-07 12:00:00" });
    assert.equal(new URL(url).searchParams.get("externalReference"), intentId);
    return Response.json({ data: options.empty ? [] : options.duplicate ? [payment, { ...payment, id: "pay_duplicate" }] : [payment], hasMore: false });
  }) as typeof fetch;
  return { provider: new AsaasPaymentAdapter("https://api.provider.invalid", "test-secret", fetchMock), posts: () => posts, requests };
}

test("API012/013: accepted Asaas POST with lost response recovers one usable charge without another POST", async () => {
  const repo = new InMemoryPaymentRepository(); const intent = prepared(); await repo.saveIntent({ intent });
  const remote = asaasMock(intent.id, { loseResponse: true }); const resume = new ResumePaymentCreationService(repo, remote.provider);
  await assert.rejects(resume.execute(intent), /payment_creation_uncertain/);
  const pending = (await repo.getIntentById("merchant_recovery", intent.id))!;
  assert.equal(pending.snapshot().creation?.state, "uncertain");
  const result = await resume.execute(pending);
  assert.equal(remote.posts(), 1); assert.equal(result.providerPaymentId, "pay_unique");
  assert.equal(result.buyerFacing?.qrCodeCopyPaste, "pix_usable"); assert.equal(result.creation?.state, "complete");
  assert.equal(repo.capturedEvents.length, 1);
});

test("API013: crash after initial reservation resumes ready intent; concurrent replicas share a lease", async () => {
  const repo = new InMemoryPaymentRepository(); const intent = prepared(); await repo.saveIntent({ intent });
  const remote = asaasMock(intent.id); const resume = new ResumePaymentCreationService(repo, remote.provider);
  const copies = await Promise.all(Array.from({ length: 15 }, () => repo.getIntentById("merchant_recovery", intent.id)));
  await Promise.all(copies.map(copy => resume.execute(copy!)));
  assert.equal(remote.posts(), 1);
  assert.equal((await repo.getIntentById("merchant_recovery", intent.id))!.snapshot().creation?.state, "complete");
});

test("API013: expired lease after accepted charge and failed local commit recovers provider result", async () => {
  const repo = new InMemoryPaymentRepository(); const intent = prepared(); await repo.saveIntent({ intent });
  const remote = asaasMock(intent.id); const resume = new ResumePaymentCreationService(repo, remote.provider);
  const save = repo.saveIntentWithOutbox.bind(repo); let fail = true;
  repo.saveIntentWithOutbox = async (...args) => { if (fail) { fail = false; throw new Error("database unavailable after POST"); } return save(...args); };
  await assert.rejects(resume.execute(intent), /payment_creation_uncertain/);
  const result = await resume.execute((await repo.getIntentById("merchant_recovery", intent.id))!);
  assert.equal(remote.posts(), 1); assert.equal(result.providerPaymentId, "pay_unique");
});

for (const scenario of ["empty", "duplicate", "mismatch"] as const) {
  test(`API012: Asaas ${scenario} lookup retains uncertainty and never repeats financial POST`, async () => {
    const repo = new InMemoryPaymentRepository(); const intent = prepared(); await repo.saveIntent({ intent });
    const remote = asaasMock(intent.id, { loseResponse: true, [scenario]: true }); const resume = new ResumePaymentCreationService(repo, remote.provider);
    await assert.rejects(resume.execute(intent), /payment_creation_uncertain/);
    for (let i = 0; i < 3; i++) {
      try { await resume.execute((await repo.getIntentById("merchant_recovery", intent.id))!); } catch (error) { assert.match(String(error), /payment_creation_uncertain/); }
    }
    const result = (await repo.getIntentById("merchant_recovery", intent.id))!.snapshot();
    assert.equal(result.creation?.state, "uncertain"); assert.equal(result.providerPaymentId, undefined); assert.equal(remote.posts(), 1);
  });
}

test("API013: Stripe retries stable parameters within retention and only searches after 23 hours", async () => {
  const provider = new StripePaymentAdapter("sk_test_fake", "pk_test_fake");
  const input: CreateProviderPaymentInput = { ...prepared().snapshot().creation!.input, method: "card", stripeConnectAccountId: "acct_owned", platformFeeCents: 0 };
  const calls: any[] = [];
  (provider as any).stripe = { paymentIntents: {
    create: async (body: unknown, options: unknown) => { calls.push({ body, options }); return { id: "pi_one", client_secret: "client-secret" }; },
    search: async () => { calls.push("search"); return { has_more: false, data: [] }; },
  } };
  await provider.recoverPayment(input, new Date().toISOString());
  assert.equal(calls[0].options.idempotencyKey, "stable-key");
  assert.deepEqual(calls[0].body.transfer_data, { destination: "acct_owned" });
  assert.equal(calls[0].body.application_fee_amount, undefined);
  assert.equal(await provider.recoverPayment(input, new Date(Date.now() - 24 * 3600_000).toISOString()), null);
  assert.equal(calls.length, 2); assert.equal(calls[1], "search");
});

test("API014: card fee snapshot survives configuration changes and dispatch forwards captured total and intent ID", async t => {
  const keys = ["STRIPE_SECRET_KEY_TEST", "STRIPE_PUBLISHABLE_KEY_TEST", "PLATFORM_FEE_BRL"] as const;
  const old = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  t.after(() => { for (const key of keys) old[key] === undefined ? delete process.env[key] : process.env[key] = old[key]; });
  process.env.STRIPE_SECRET_KEY_TEST = "sk_test_fake"; process.env.STRIPE_PUBLISHABLE_KEY_TEST = "pk_test_fake";
  for (const fee of ["1.99", "0"]) {
    process.env.PLATFORM_FEE_BRL = fee;
    const checkout = new InMemoryCheckoutRepository(); const repo = new InMemoryPaymentRepository();
    const session = checkoutSession({ cart: { currency: "BRL", total: 100, currentDiscount: 10, items: [{ sku: "sku", name: "Item", price: 50, quantity: 2 }] } });
    await checkout.saveSession(session);
    checkout.getStripeConnectAccountId = async () => "acct_owned";
    const inputs: CreateProviderPaymentInput[] = [];
    const provider: PaymentProviderPort = { createPayment: async input => { inputs.push(input); return { providerPaymentId: "pi_one", status: "requires_action", buyerFacingPayload: { clientSecret: "secret" } }; } };
    const result = await new CreatePaymentIntentUseCase(checkout, checkout, repo, provider).execute({ merchant_id: session.merchantId, session_id: session.sessionId, idempotency_key: `fee-${fee}`, method: "card" });
    const expected = 9000 + Math.round((session.shipping?.customerPrice ?? 0) * 100) + Math.round(Number(fee) * 100);
    assert.equal(result.amountCents, expected); assert.equal(inputs[0].amountCents, expected); assert.equal(result.amountBreakdown?.platformFeeCents, Math.round(Number(fee) * 100));
    process.env.PLATFORM_FEE_BRL = "99";
    const completions: CheckoutPaymentApprovedInput[] = [];
    const port: CheckoutPaymentPort = { completeAfterApproval: async input => { completions.push(input); }, recordPaymentFailure: async () => {}, recordPaymentStatusChanged: async () => {} };
    await new PaymentDispatchService(repo, port).markApprovedAndComplete((await repo.getIntentById(session.merchantId, result.id))!, "pi_one");
    assert.equal(completions[0].orderTotalMajorUnits, expected / 100); assert.equal(completions[0].paymentIntentId, result.id); assert.deepEqual(completions[0].amountBreakdown, result.amountBreakdown);
  }
});

test("API015: stale failed/cancelled writers cannot overwrite approval or append losing events", async () => {
  const repo = new InMemoryPaymentRepository(); const intent = prepared(); await repo.saveIntent({ intent });
  const approved = (await repo.getIntentById("merchant_recovery", intent.id))!;
  const failed = (await repo.getIntentById("merchant_recovery", intent.id))!;
  const cancelled = (await repo.getIntentById("merchant_recovery", intent.id))!;
  approved.markApproved({ providerPaymentId: "pay_unique", approvedAmountCents: 1099 }); await repo.saveIntent({ intent: approved });
  failed.markFailed(); cancelled.markCancelled();
  await assert.rejects(repo.saveIntent({ intent: failed }), /concurrent_change/);
  await assert.rejects(repo.saveIntent({ intent: cancelled }), /concurrent_change/);
  const current = (await repo.getIntentById("merchant_recovery", intent.id))!;
  current.markRefunded(); await repo.saveIntent({ intent: current });
  await assert.rejects(repo.saveIntent({ intent: approved }), /concurrent_change/);
  assert.equal((await repo.getIntentById("merchant_recovery", intent.id))!.status, "refunded");
});

test("API015: durable approval handler recovers checkout after post-commit crash and propagates failures", async () => {
  const repo = new InMemoryPaymentRepository(); const intent = prepared(); await repo.saveIntent({ intent });
  const bus = new InMemoryDomainEventBus(); let attempts = 0; const orders = new Set<string>();
  const port: CheckoutPaymentPort = { completeAfterApproval: async input => { attempts++; if (attempts === 1) throw new Error("crash_before_order"); orders.add(input.paymentIntentId!); }, recordPaymentFailure: async () => {}, recordPaymentStatusChanged: async () => {} };
  const dispatch = new PaymentDispatchService(repo, port, undefined, undefined, bus); dispatch.onModuleInit();
  await assert.rejects(dispatch.markApprovedAndComplete(intent, "pay_unique"), /crash_before_order/);
  assert.equal((await repo.getIntentById("merchant_recovery", intent.id))!.status, "approved"); assert.equal(repo.capturedEvents.length, 1);
  const event = repo.capturedEvents[0];
  await bus.publish({ eventType: event.event_type, merchantId: event.merchant_id, payload: event.payload });
  await bus.publish({ eventType: event.event_type, merchantId: event.merchant_id, payload: event.payload });
  assert.equal(orders.size, 1); assert.equal(attempts, 3);
});

test("API013: reconciliation resumes creation without provider ID instead of permanently skipping", async () => {
  const repo = new InMemoryPaymentRepository(); const intent = prepared(); await repo.saveIntent({ intent });
  const remote = asaasMock(intent.id);
  const port: CheckoutPaymentPort = { completeAfterApproval: async () => {}, recordPaymentFailure: async () => {}, recordPaymentStatusChanged: async () => {} };
  remote.provider.fetchPaymentStatus = async () => ({ state: "pending" });
  const result = await new ReconcilePaymentIntentsUseCase(repo, remote.provider, port).execute({ staleAfterMs: 0 });
  assert.equal(remote.posts(), 1); assert.equal(result.reconciled[0].outcome, "still_pending");
  assert.equal((await repo.getIntentById("merchant_recovery", intent.id))!.snapshot().providerPaymentId, "pay_unique");
});

test("API014: idempotent retry rejects changed sale identities and hides persisted provider input", async () => {
  const checkout = new InMemoryCheckoutRepository(); const repo = new InMemoryPaymentRepository();
  const session = checkoutSession({ customer: { fullName: "Buyer", email: "buyer@example.invalid", cpf: "00000000000", asaasCustomerId: "cus_one" },
    cart: { currency: "BRL", total: 10, currentDiscount: 0, items: [{ sku: "sku-one", name: "Item", price: 10, quantity: 1 }] } });
  await checkout.saveSession(session); let creates = 0;
  const provider: PaymentProviderPort = { createPayment: async () => { creates++; return { providerPaymentId: "pay_one", status: "requires_action", buyerFacingPayload: {} }; } };
  const uc = new CreatePaymentIntentUseCase(checkout, checkout, repo, provider);
  const input = { merchant_id: session.merchantId, session_id: session.sessionId, idempotency_key: "same-sale", method: "pix" as const };
  const result = await uc.execute(input);
  assert.equal("creation" in result, false); assert.equal("version" in result, false);
  assert.match(result.amountBreakdown!.cartFingerprint!, /^[a-f0-9]{64}$/);
  assert.equal((await uc.execute(input)).id, result.id); assert.equal(creates, 1);
  await checkout.saveSession({ ...session, cart: { ...session.cart, items: [{ ...session.cart.items[0], sku: "sku-other" }] } });
  await assert.rejects(uc.execute(input), /payment_idempotency_input_mismatch/);
  assert.equal(creates, 1);
});
