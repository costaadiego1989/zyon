import test from "node:test";
import assert from "node:assert/strict";
import { StartCheckoutUseCase } from "../../../checkout/application/use-cases/start-checkout.use-case.js";
import { CompleteOrderUseCase } from "../../../checkout/application/use-cases/complete-order.use-case.js";
import { InMemoryCheckoutRepository } from "../../../checkout/infrastructure/repositories/in-memory-checkout.repository.js";
import { CreatePaymentIntentUseCase } from "../../application/create-payment-intent.use-case.js";
import { HandleAsaasWebhookUseCase } from "../../application/handle-asaas-webhook.use-case.js";
import { InMemoryPaymentRepository } from "../../infrastructure/in-memory-payment.repository.js";
import { FakePaymentProvider } from "../../infrastructure/fake-payment-provider.js";
import { CheckoutPaymentAdapter } from "../../infrastructure/checkout-payment.adapter.js";
import { InMemoryDomainEventBus } from "../../../../shared/events/in-memory-domain-event-bus.js";
import { PaymentApprovedHandler } from "../../../checkout/application/handlers/payment-approved.handler.js";

function makeCheckoutPaymentAdapter(checkout: InMemoryCheckoutRepository): CheckoutPaymentAdapter {
  const eventBus = new InMemoryDomainEventBus();
  const handler = new PaymentApprovedHandler(eventBus, new CompleteOrderUseCase(checkout, checkout, checkout));
  handler.onModuleInit();
  return new CheckoutPaymentAdapter(checkout, checkout, eventBus);
}

test("checkout payment happy path: start-checkout → intent → PAYMENT_RECEIVED → pedido completado", async () => {
  const checkout = new InMemoryCheckoutRepository();
  const payments = new InMemoryPaymentRepository();
  const merchantId = `m_pay_e2e_${crypto.randomUUID().replace(/-/g, "").slice(0, 18)}`;
  const sessionId = `chk_e2e_${crypto.randomUUID().slice(0, 12)}`;

  await new StartCheckoutUseCase(checkout, checkout, checkout).execute({
    merchant_id: merchantId,
    session_id: sessionId,
    cart: {
      currency: "BRL",
      total: 300,
      items: [{ sku: "sku1", name: "Item", price: 300, quantity: 1 }]
    },
    customer: { email: "buyer@test.com", phone: "11999998888", asaasCustomerId: "cus_fixture_e2e" }
  });

  const intentSnap = await new CreatePaymentIntentUseCase(checkout, payments, new FakePaymentProvider(), checkout).execute({
    merchant_id: merchantId,
    session_id: sessionId,
    idempotency_key: `idem_${crypto.randomUUID()}`
  });

  const providerPaymentId = intentSnap.providerPaymentId!;
  assert.equal(intentSnap.amountCents / 100, 300);

  const checkoutPayment = makeCheckoutPaymentAdapter(checkout);
  const webhook = new HandleAsaasWebhookUseCase(payments, checkoutPayment);

  const processed = await webhook.execute(undefined, {
    id: `evt_e2e_${crypto.randomUUID().replace(/-/g, "").slice(0, 22)}`,
    event: "PAYMENT_RECEIVED",
    payment: {
      id: providerPaymentId,
      value: 300,
      externalReference: intentSnap.id
    }
  });

  assert.equal(processed.outcome, "processed");
  assert.equal(processed.outcome === "processed" ? processed.effect : "", "checkout_completed_after_payment");

  const order = checkout.getCompletedOrder(merchantId, sessionId, providerPaymentId);
  assert.ok(order);
  assert.equal(order!.orderTotal, 300);
  assert.ok(order!.trackingCode);

  const approved = await payments.getIntentById(intentSnap.id);
  assert.deepEqual(approved?.snapshot().statusHistory.map((entry) => entry.status), [
    "pending",
    "requires_action",
    "approved"
  ]);
  const outbox = checkout.listOutbox(merchantId);
  assert.ok(outbox.some((event) => event.event_type === "payment.status.changed" && (event.payload as any).status === "approved"));
  assert.ok(outbox.some((event) => event.event_type === "whatsapp.message.requested" && (event.payload as any).tracking_code === order!.trackingCode));
  assert.ok(
    checkout
      .getSession(merchantId, sessionId)
      ?.chatHistory.some((turn) => turn.text.includes("Pagamento confirmado"))
  );
});

test("checkout payment: PAYMENT_DELETED não completa ordem", async () => {
  const checkout = new InMemoryCheckoutRepository();
  const payments = new InMemoryPaymentRepository();
  const merchantId = `m_pay_fail_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
  const sessionId = `chk_fail_${crypto.randomUUID().slice(0, 12)}`;

  await new StartCheckoutUseCase(checkout, checkout, checkout).execute({
    merchant_id: merchantId,
    session_id: sessionId,
    cart: {
      currency: "BRL",
      total: 150,
      items: [{ sku: "x", name: "X", price: 150, quantity: 1 }]
    },
    customer: { email: "buyer@test.com", asaasCustomerId: "cus_fixture_e2e" }
  });

  const intentSnap = await new CreatePaymentIntentUseCase(checkout, payments, new FakePaymentProvider(), checkout).execute({
    merchant_id: merchantId,
    session_id: sessionId,
    idempotency_key: `idem_del_${crypto.randomUUID()}`
  });

  const providerPaymentId = intentSnap.providerPaymentId!;
  const checkoutPayment = makeCheckoutPaymentAdapter(checkout);
  const webhook = new HandleAsaasWebhookUseCase(payments, checkoutPayment);

  await webhook.execute(undefined, {
    id: `evt_del_${crypto.randomUUID().replace(/-/g, "").slice(0, 20)}`,
    event: "PAYMENT_DELETED",
    payment: {
      id: providerPaymentId,
      value: 150,
      externalReference: intentSnap.id
    }
  });

  assert.equal(checkout.getCompletedOrder(merchantId, sessionId, providerPaymentId), undefined);
  const failed = await payments.getIntentById(intentSnap.id);
  assert.deepEqual(failed?.snapshot().statusHistory.map((entry) => entry.status), [
    "pending",
    "requires_action",
    "failed"
  ]);
  assert.ok(checkout.listOutbox(merchantId).some((event) => event.event_type === "payment.status.changed" && (event.payload as any).status === "failed"));
  assert.ok(
    checkout
      .getSession(merchantId, sessionId)
      ?.chatHistory.some((turn) => turn.text.includes("Pagamento falhou"))
  );
});
