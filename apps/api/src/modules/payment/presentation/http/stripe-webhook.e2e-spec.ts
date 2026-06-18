import test from "node:test";
import assert from "node:assert/strict";
import type Stripe from "stripe";
import { StartCheckoutUseCase } from "../../../checkout/application/use-cases/start-checkout.use-case.js";
import { CompleteOrderUseCase } from "../../../checkout/application/use-cases/complete-order.use-case.js";
import { InMemoryCheckoutRepository } from "../../../checkout/infrastructure/repositories/in-memory-checkout.repository.js";
import { CreatePaymentIntentUseCase } from "../../application/create-payment-intent.use-case.js";
import { HandleStripeWebhookUseCase } from "../../application/handle-stripe-webhook.use-case.js";
import { InMemoryPaymentRepository } from "../../infrastructure/in-memory-payment.repository.js";
import { CheckoutPaymentAdapter } from "../../infrastructure/checkout-payment.adapter.js";
import { InMemoryDomainEventBus } from "../../../../shared/events/in-memory-domain-event-bus.js";
import { PaymentApprovedHandler } from "../../../checkout/application/handlers/payment-approved.handler.js";
import type {
  CreateProviderPaymentInput,
  CreateProviderPaymentOutput,
  PaymentProviderPort
} from "../../domain/ports/payment-provider.port.js";

// Fake Stripe provider: returns a fake clientSecret without touching the Stripe API
class FakeStripeProvider implements PaymentProviderPort {
  readonly lastIntentId: string[] = [];

  async createPayment(input: CreateProviderPaymentInput): Promise<CreateProviderPaymentOutput> {
    if (input.creditCard) throw new Error("stripe_raw_card_forbidden");
    const providerPaymentId = `pi_test_${input.intentId.replace(/[^a-z0-9]/gi, "")}`;
    this.lastIntentId.push(input.intentId);
    return {
      providerPaymentId,
      status: "requires_action",
      buyerFacingPayload: {
        clientSecret: `${providerPaymentId}_secret_test`,
        stripePublishableKey: "pk_test_fake"
      }
    };
  }
}

function makeCheckoutPaymentAdapter(checkout: InMemoryCheckoutRepository): CheckoutPaymentAdapter {
  const eventBus = new InMemoryDomainEventBus();
  new PaymentApprovedHandler(eventBus, new CompleteOrderUseCase(checkout, checkout, checkout)).onModuleInit();
  return new CheckoutPaymentAdapter(checkout, checkout, eventBus);
}

function stripeEvent(type: string, pi: Partial<Stripe.PaymentIntent> & { id: string }): Stripe.Event {
  return {
    id: `evt_${crypto.randomUUID().replace(/-/g, "").slice(0, 24)}`,
    object: "event",
    type,
    api_version: "2026-04-22.dahlia",
    created: Math.floor(Date.now() / 1000),
    livemode: false,
    pending_webhooks: 0,
    request: null,
    data: { object: pi as Stripe.PaymentIntent }
  } as unknown as Stripe.Event;
}

async function setupSession(
  checkout: InMemoryCheckoutRepository,
  payments: InMemoryPaymentRepository,
  provider: PaymentProviderPort,
  merchantId: string,
  sessionId: string,
  amountBrl: number
) {
  await new StartCheckoutUseCase(checkout, checkout, checkout).execute({
    merchant_id: merchantId,
    session_id: sessionId,
    cart: {
      currency: "BRL",
      total: amountBrl,
      items: [{ sku: "prod", name: "Produto", price: amountBrl, quantity: 1 }]
    },
    customer: {
      email: "buyer@test.com",
      asaasCustomerId: "cus_stripe_fixture",
    },
    shipping: {
      customerPrice: 0,
      realCost: 0,
      method: "Test shipping",
    },
  });

  return new CreatePaymentIntentUseCase(checkout, checkout, payments, provider).execute({
    merchant_id: merchantId,
    session_id: sessionId,
    idempotency_key: `idem_stripe_${crypto.randomUUID()}`,
    method: "card"
  });
}

test("Stripe webhook: payment_intent.succeeded → intent aprovado + pedido completado", async () => {
  const checkout = new InMemoryCheckoutRepository();
  const payments = new InMemoryPaymentRepository();
  const provider = new FakeStripeProvider();
  const merchantId = `m_stripe_ok_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
  const sessionId = `chk_stripe_ok_${crypto.randomUUID().slice(0, 10)}`;

  const intentSnap = await setupSession(checkout, payments, provider, merchantId, sessionId, 500);

  assert.equal(intentSnap.status, "requires_action");
  assert.ok(intentSnap.buyerFacing?.clientSecret);
  assert.ok(intentSnap.buyerFacing?.stripePublishableKey);
  assert.ok(intentSnap.providerPaymentId?.startsWith("pi_test_"));

  const checkoutPayment = makeCheckoutPaymentAdapter(checkout);
  const webhookUC = new HandleStripeWebhookUseCase(payments, checkoutPayment);

  const event = stripeEvent("payment_intent.succeeded", {
    id: intentSnap.providerPaymentId!,
    amount: 50000,
    amount_received: 50000,
    currency: "brl",
    status: "succeeded",
    metadata: { intent_id: intentSnap.id, merchant_id: merchantId, session_id: sessionId },
    last_payment_error: null
  });

  const result = await webhookUC.dispatchEvent(event);

  assert.equal(result.outcome, "processed");
  assert.equal(result.outcome === "processed" ? result.effect : "", "checkout_completed_after_payment");

  const approved = await payments.getIntentById(merchantId, intentSnap.id);
  assert.deepEqual(
    approved?.snapshot().statusHistory.map((e) => e.status),
    ["pending", "requires_action", "approved"]
  );
  assert.equal(approved?.snapshot().approvedAmountCents, 50000);

  const order = checkout.getCompletedOrder(merchantId, sessionId, intentSnap.providerPaymentId!);
  assert.ok(order, "pedido deve ter sido completado");
  assert.equal(order!.orderTotal, 500);

  const outbox = checkout.listOutbox(merchantId);
  assert.ok(outbox.some((ev) => ev.event_type === "payment.status.changed" && (ev.payload as any).status === "approved"));
  assert.ok(
    checkout.getSession(merchantId, sessionId)?.chatHistory.some((t) => t.text.includes("Pagamento confirmado"))
  );
});

test("Stripe webhook: payment_intent.payment_failed → intent failed + chat atualizado", async () => {
  const checkout = new InMemoryCheckoutRepository();
  const payments = new InMemoryPaymentRepository();
  const provider = new FakeStripeProvider();
  const merchantId = `m_stripe_fail_${crypto.randomUUID().replace(/-/g, "").slice(0, 10)}`;
  const sessionId = `chk_stripe_fail_${crypto.randomUUID().slice(0, 10)}`;

  const intentSnap = await setupSession(checkout, payments, provider, merchantId, sessionId, 200);

  const checkoutPayment = makeCheckoutPaymentAdapter(checkout);
  const webhookUC = new HandleStripeWebhookUseCase(payments, checkoutPayment);

  const event = stripeEvent("payment_intent.payment_failed", {
    id: intentSnap.providerPaymentId!,
    amount: 20000,
    amount_received: 0,
    currency: "brl",
    status: "requires_payment_method",
    metadata: { intent_id: intentSnap.id, merchant_id: merchantId, session_id: sessionId },
    last_payment_error: { message: "Your card was declined." } as Stripe.PaymentIntent.LastPaymentError
  });

  const result = await webhookUC.dispatchEvent(event);

  assert.equal(result.outcome, "processed");
  assert.equal(result.outcome === "processed" ? result.effect : "", "payment_failed");

  const failed = await payments.getIntentById(merchantId, intentSnap.id);
  assert.deepEqual(
    failed?.snapshot().statusHistory.map((e) => e.status),
    ["pending", "requires_action", "failed"]
  );

  const outbox = checkout.listOutbox(merchantId);
  assert.ok(outbox.some((ev) => ev.event_type === "payment.status.changed" && (ev.payload as any).status === "failed"));
  assert.ok(
    checkout.getSession(merchantId, sessionId)?.chatHistory.some((t) => t.text.includes("Pagamento falhou"))
  );
});

test("Stripe webhook: evento duplicado retorna outcome=duplicate", async () => {
  const checkout = new InMemoryCheckoutRepository();
  const payments = new InMemoryPaymentRepository();
  const provider = new FakeStripeProvider();
  const merchantId = `m_stripe_dup_${crypto.randomUUID().replace(/-/g, "").slice(0, 10)}`;
  const sessionId = `chk_stripe_dup_${crypto.randomUUID().slice(0, 10)}`;

  const intentSnap = await setupSession(checkout, payments, provider, merchantId, sessionId, 100);

  const checkoutPayment = makeCheckoutPaymentAdapter(checkout);
  const webhookUC = new HandleStripeWebhookUseCase(payments, checkoutPayment);

  const event = stripeEvent("payment_intent.succeeded", {
    id: intentSnap.providerPaymentId!,
    amount: 10000,
    amount_received: 10000,
    currency: "brl",
    status: "succeeded",
    metadata: { intent_id: intentSnap.id, merchant_id: merchantId, session_id: sessionId },
    last_payment_error: null
  });

  const first = await webhookUC.dispatchEvent(event);
  assert.equal(first.outcome, "processed");

  const second = await webhookUC.dispatchEvent(event);
  assert.equal(second.outcome, "duplicate");
});

test("Stripe webhook: metadata.intent_id ausente → ignored", async () => {
  const checkout = new InMemoryCheckoutRepository();
  const payments = new InMemoryPaymentRepository();
  const checkoutPayment = makeCheckoutPaymentAdapter(checkout);
  const webhookUC = new HandleStripeWebhookUseCase(payments, checkoutPayment);

  const event = stripeEvent("payment_intent.succeeded", {
    id: "pi_test_no_meta",
    amount: 5000,
    amount_received: 5000,
    currency: "brl",
    status: "succeeded",
    metadata: {},
    last_payment_error: null
  });

  const result = await webhookUC.dispatchEvent(event);
  assert.equal(result.outcome, "processed");
  assert.equal(result.outcome === "processed" ? result.effect : "", "ignored_missing_intent_id");
});

test("Stripe provider: rawCard presente → lança stripe_raw_card_forbidden", async () => {
  const provider = new FakeStripeProvider();
  await assert.rejects(
    () =>
      provider.createPayment({
        merchantId: "m",
        sessionId: "s",
        intentId: "i",
        amountCents: 100,
        currency: "BRL",
        method: "card",
        creditCard: { holderName: "X", number: "4111111111111111", expiryMonth: "12", expiryYear: "2030", ccv: "123" }
      }),
    /stripe_raw_card_forbidden/
  );
});
