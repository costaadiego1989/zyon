import "reflect-metadata";
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { randomUUID } from "node:crypto";
import { Controller, Inject, Module, type INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import Stripe from "stripe";
import type { CompletedOrder } from "@zyon/shared-types";
import { StripeWebhookController } from "../src/modules/payment/presentation/http/stripe-webhook.controller.js";
import { HandleStripeWebhookUseCase } from "../src/modules/payment/application/handle-stripe-webhook.use-case.js";
import { PaymentIntentEntity } from "../src/modules/payment/domain/payment-intent.entity.js";
import { paymentCartFingerprint } from "../src/modules/checkout/domain/services/payment-cart-fingerprint.js";
import { PaymentDispatchService } from "../src/modules/payment/application/services/payment-dispatch.service.js";
import { InMemoryPaymentRepository } from "../src/modules/payment/infrastructure/in-memory-payment.repository.js";
import { CheckoutPaymentAdapter } from "../src/modules/payment/infrastructure/checkout-payment.adapter.js";
import { InMemoryCheckoutRepository } from "../src/modules/checkout/infrastructure/repositories/in-memory-checkout.repository.js";
import { InMemoryDomainEventBus } from "../src/shared/events/in-memory-domain-event-bus.js";
import { createStartCheckoutUseCase } from "../src/modules/checkout/application/use-cases/start-checkout.fixture.js";
import { CompleteOrderUseCase } from "../src/modules/checkout/application/use-cases/complete-order.use-case.js";
import { PaymentApprovedHandler } from "../src/modules/checkout/application/handlers/payment-approved.handler.js";

// Minimal test-only Nest host. Never load AppModule, dotenv or provider secrets.
@Controller()
class PaymentHttpFixtureController extends StripeWebhookController {
  constructor(@Inject(HandleStripeWebhookUseCase) useCase: HandleStripeWebhookUseCase) { super(useCase); }
}

class ObservedCheckout extends InMemoryCheckoutRepository {
  readonly orderSaves: CompletedOrder[] = [];
  saveCompletedOrder(order: CompletedOrder) {
    this.orderSaves.push(structuredClone(order));
    return super.saveCompletedOrder(order);
  }
}

const keys = ["STRIPE_SECRET_KEY", "STRIPE_SECRET_KEY_TEST", "STRIPE_WEBHOOK_SECRET", "STRIPE_WEBHOOK_SECRET_TEST"] as const;
const previous = keys.map(key => process.env[key]);
const secret = "whsec_synthetic_payment_http_only";
const stripe = new Stripe("sk_test_synthetic_payment_http_only");
const checkout = new ObservedCheckout();
const payments = new InMemoryPaymentRepository(checkout);
let app: INestApplication | undefined;
let endpoint: string;

before(async () => {
  for (const key of keys) process.env[key] = key.includes("WEBHOOK") ? secret : "sk_test_synthetic_payment_http_only";
  const bus = new InMemoryDomainEventBus();
  const approvalReader = { async find(merchantId: string, sessionId: string, intentId: string) {
    const intent = await payments.getIntentById(merchantId, intentId);
    if (!intent || intent.snapshot().sessionId !== sessionId) return null;
    const snapshot = intent.snapshot();
    return { ...snapshot, approvedAmountCents: snapshot.approvedAmountCents ?? null,
      providerPaymentId: snapshot.providerPaymentId ?? null, acceptedOfferId: snapshot.acceptedOfferId ?? null,
      amountBreakdown: snapshot.amountBreakdown ?? null };
  } };
  const complete = new CompleteOrderUseCase(checkout, checkout, checkout,
    undefined, undefined, undefined, undefined, undefined, undefined, undefined,
    undefined, undefined, undefined, undefined, undefined, undefined, approvalReader);
  new PaymentApprovedHandler(bus, complete).onModuleInit();
  const dispatch = new PaymentDispatchService(payments, new CheckoutPaymentAdapter(checkout, checkout, bus));
  const useCase = new HandleStripeWebhookUseCase(payments, dispatch);
  @Module({ controllers: [PaymentHttpFixtureController], providers: [{ provide: HandleStripeWebhookUseCase, useValue: useCase }] })
  class PaymentHttpFixtureModule {}
  app = await NestFactory.create(PaymentHttpFixtureModule, { rawBody: true, logger: false });
  app.setGlobalPrefix("v1");
  await app.listen(0, "127.0.0.1");
  const address = app.getHttpServer().address();
  assert.ok(address && typeof address !== "string");
  endpoint = `http://127.0.0.1:${address.port}/v1/webhooks/stripe`;
});
after(async () => {
  try { await app?.close(); } finally {
    keys.forEach((key, index) => { const value = previous[index];
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    });
  }
});

async function fixture() {
  const merchantId = `qa_synthetic_${randomUUID()}`, sessionId = `checkout_${randomUUID()}`;
  await createStartCheckoutUseCase(checkout, checkout).execute({ merchant_id: merchantId, session_id: sessionId,
    cart: { currency: "BRL", total: 100, items: [{ sku: "synthetic-product", name: "Produto fictício", price: 100, quantity: 1 }] },
    customer: { email: "synthetic@example.test", asaasCustomerId: "cus_synthetic_http" },
    shipping: { customerPrice: 0, realCost: 0, method: "Synthetic shipping fixture" },
  });
  // Explicit trusted-state fixture, not proof of buyer/address authentication.
  const session = checkout.getSession(merchantId, sessionId);
  assert.ok(session);
  await checkout.saveSession({ ...session, customer: { ...session.customer, asaasCustomerId: "cus_synthetic_http" },
    shipping: { customerPrice: 0, realCost: 0, method: "Synthetic shipping fixture" } });
  const preparedSession = checkout.getSession(merchantId, sessionId);
  assert.ok(preparedSession);
  // An already-issued synthetic intent is an explicit fixture precondition.
  // Admission/stock/provider creation require their separate SQL/AppModule gate;
  // do not override those guards or pretend this test executed them.
  const pending = PaymentIntentEntity.create({ merchantId, sessionId, idempotencyKey: randomUUID(),
    amountCents: 10099, currency: "BRL", method: "card", amountBreakdown: {
      version: 1, currency: "BRL", cartFingerprint: paymentCartFingerprint(preparedSession),
      itemsSubtotalCents: 10000, discountCents: 0, shippingCents: 0, platformFeeCents: 99, totalCents: 10099,
    } });
  pending.markRequiresAction({ providerPaymentId: `pi_synthetic_${randomUUID()}` });
  await payments.saveIntent({ intent: pending });
  const intent = pending.snapshot();
  assert.equal(intent.status, "requires_action");
  assert.ok(intent.providerPaymentId);
  return { merchantId, sessionId, intent };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
function event(f: Fixture, objectOverrides: Record<string, unknown> = {}, type = "payment_intent.succeeded", id = `evt_${randomUUID()}`) {
  return { id, object: "event", type, created: Math.floor(Date.now() / 1000), livemode: false,
    data: { object: { id: f.intent.providerPaymentId, object: "payment_intent", amount: f.intent.amountCents,
      amount_received: f.intent.amountCents, currency: "brl", status: "succeeded", livemode: false,
      metadata: { intent_id: f.intent.id, merchant_id: f.merchantId, session_id: f.sessionId }, ...objectOverrides } } };
}
async function deliver(value: ReturnType<typeof event>, forged = false) {
  const body = JSON.stringify(value);
  const signed = stripe.webhooks.generateTestHeaderString({ payload: body, secret: forged ? "whsec_wrong_synthetic_secret" : secret });
  const response = await fetch(endpoint, { method: "POST", body, redirect: "error",
    headers: { "content-type": "application/json", "stripe-signature": signed, connection: "close" },
    signal: AbortSignal.timeout(5_000) });
  return { status: response.status, body: await response.json() };
}
async function snapshot(f: Fixture) {
  const intent = await payments.getIntentById(f.merchantId, f.intent.id);
  assert.ok(intent);
  return intent.snapshot();
}
function assertNoOrder(f: Fixture) {
  assert.equal(checkout.getCompletedOrder(f.merchantId, f.sessionId, f.intent.providerPaymentId!), undefined);
  assert.equal(checkout.orderSaves.filter(order => order.merchantId === f.merchantId).length, 0);
}
async function assertOneApprovedOrder(f: Fixture) {
  const saved = await snapshot(f);
  assert.equal(saved.status, "approved");
  assert.equal(saved.approvedAmountCents, f.intent.amountCents);
  assert.equal(saved.statusHistory.filter(entry => entry.status === "approved").length, 1);
  const order = checkout.getCompletedOrder(f.merchantId, f.sessionId, f.intent.providerPaymentId!);
  assert.ok(order);
  assert.equal(order.orderTotal, 100);
  assert.equal(checkout.orderSaves.filter(value => value.merchantId === f.merchantId).length, 1);
  assert.equal(checkout.listOutbox(f.merchantId).filter(value => value.event_type === "payment.status.changed" &&
    (value.payload as { status?: string }).status === "approved").length, 1);
  assert.equal(checkout.getSession(f.merchantId, f.sessionId)?.chatHistory.filter(turn => turn.text.includes("Pagamento confirmado")).length, 1);
}

test("signed HTTP approval reaches the actual dispatcher and creates one local paid order", async () => {
  const f = await fixture();
  const result = await deliver(event(f));
  assert.equal(result.status, 200);
  assert.deepEqual(result.body, { outcome: "processed", effect: "checkout_completed_after_payment" });
  await assertOneApprovedOrder(f);
});

test("eight concurrent approvals plus another event ID do not duplicate order, approval outbox or confirmation", async () => {
  const f = await fixture(), original = event(f);
  const results = await Promise.all(Array.from({ length: 8 }, () => deliver(original)));
  assert.ok(results.every(result => result.status === 200));
  assert.equal(results.filter(result => result.body.outcome === "processed").length, 1);
  assert.equal(results.filter(result => result.body.outcome === "duplicate").length, 7);
  const outboxBefore = structuredClone(checkout.listOutbox(f.merchantId));
  const later = await deliver(event(f));
  assert.deepEqual(later, { status: 200, body: { outcome: "processed", effect: "already_approved" } });
  assert.deepEqual(checkout.listOutbox(f.merchantId), outboxBefore);
  await assertOneApprovedOrder(f);
});

test("distinct signed event IDs arriving concurrently for one payment still create one order and confirmation", async () => {
  const f = await fixture();
  const results = await Promise.all(Array.from({ length: 6 }, () => deliver(event(f))));
  assert.ok(results.every(result => result.status === 200 && result.body.outcome === "processed"));
  assert.equal(results.filter(result => result.body.effect === "checkout_completed_after_payment").length, 1);
  assert.equal(results.filter(result => result.body.effect === "already_approved").length, 5);
  await assertOneApprovedOrder(f);
});

test("a different provider payment ID cannot replace the issued identity and the corrected event remains processable", async () => {
  const f = await fixture(), wrong = event(f, { id: `pi_wrong_${randomUUID()}` });
  const before = await snapshot(f), outbox = structuredClone(checkout.listOutbox(f.merchantId));
  const refused = await deliver(wrong);
  // Existing persistence integrity refusal is a server error, not an ACK.
  assert.equal(refused.status, 500);
  assert.deepEqual(await snapshot(f), before);
  assert.deepEqual(checkout.listOutbox(f.merchantId), outbox);
  assertNoOrder(f);
  wrong.data.object.id = f.intent.providerPaymentId;
  const corrected = await deliver(wrong);
  assert.equal(corrected.status, 200);
  assert.equal(corrected.body.effect, "checkout_completed_after_payment");
  await assertOneApprovedOrder(f);
});

test("a forged signature on a financial event cannot alter intent, order, outbox or chat", async () => {
  const f = await fixture(), before = await snapshot(f);
  const outbox = structuredClone(checkout.listOutbox(f.merchantId)), session = structuredClone(checkout.getSession(f.merchantId, f.sessionId));
  const result = await deliver(event(f), true);
  assert.equal(result.status, 401);
  assert.deepEqual(await snapshot(f), before);
  assert.deepEqual(checkout.listOutbox(f.merchantId), outbox);
  assert.deepEqual(checkout.getSession(f.merchantId, f.sessionId), session);
  assertNoOrder(f);
});

for (const delta of [-1, 1]) test(`signed amount mismatch (${delta} cent) fails without approving or creating an order`, async () => {
  const f = await fixture();
  const result = await deliver(event(f, { amount_received: f.intent.amountCents + delta }));
  assert.deepEqual(result, { status: 200, body: { outcome: "processed", effect: "stripe_value_mismatch" } });
  const saved = await snapshot(f);
  assert.equal(saved.status, "failed");
  assert.equal(saved.statusHistory.some(entry => entry.status === "approved"), false);
  assertNoOrder(f);
});

test("currency mismatch refuses approval and permits a corrected signed delivery with the same event ID", async () => {
  const f = await fixture(), original = event(f, { currency: "usd" });
  const before = await snapshot(f), outbox = structuredClone(checkout.listOutbox(f.merchantId));
  const refused = await deliver(original);
  assert.equal(refused.status, 400);
  assert.equal(refused.body.message, "stripe_currency_mismatch");
  assert.deepEqual(await snapshot(f), before);
  assert.deepEqual(checkout.listOutbox(f.merchantId), outbox);
  assertNoOrder(f);
  original.data.object.currency = "brl";
  const corrected = await deliver(original);
  assert.equal(corrected.status, 200);
  assert.equal(corrected.body.effect, "checkout_completed_after_payment");
  await assertOneApprovedOrder(f);
});

test("signed foreign-merchant metadata cannot approve either tenant's intent or create an order", async () => {
  const owner = await fixture(), foreign = await fixture();
  const ownerBefore = await snapshot(owner), foreignBefore = await snapshot(foreign);
  const outboxes = [structuredClone(checkout.listOutbox(owner.merchantId)), structuredClone(checkout.listOutbox(foreign.merchantId))];
  const result = await deliver(event(owner, { metadata: { intent_id: owner.intent.id, merchant_id: foreign.merchantId, session_id: owner.sessionId } }));
  assert.deepEqual(result, { status: 200, body: { outcome: "processed", effect: "intent_not_found" } });
  assert.deepEqual(await snapshot(owner), ownerBefore);
  assert.deepEqual(await snapshot(foreign), foreignBefore);
  assert.deepEqual(checkout.listOutbox(owner.merchantId), outboxes[0]);
  assert.deepEqual(checkout.listOutbox(foreign.merchantId), outboxes[1]);
  assertNoOrder(owner); assertNoOrder(foreign);
});

test("signed payment failure and duplicate delivery never create a paid order or repeat failure notice", async () => {
  const f = await fixture(), failed = event(f, { amount_received: 0, status: "requires_payment_method",
    last_payment_error: { message: "Synthetic card refusal" } }, "payment_intent.payment_failed");
  const first = await deliver(failed), second = await deliver(failed);
  assert.deepEqual(first, { status: 200, body: { outcome: "processed", effect: "payment_failed" } });
  assert.deepEqual(second, { status: 200, body: { outcome: "duplicate" } });
  const saved = await snapshot(f);
  assert.equal(saved.status, "failed");
  assert.equal(saved.statusHistory.filter(entry => entry.status === "failed").length, 1);
  assert.equal(checkout.getSession(f.merchantId, f.sessionId)?.chatHistory.filter(turn => turn.text.includes("Pagamento falhou")).length, 1);
  assertNoOrder(f);
});
