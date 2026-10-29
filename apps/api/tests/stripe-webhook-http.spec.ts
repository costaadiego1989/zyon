import "reflect-metadata";
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { randomUUID } from "node:crypto";
import { Controller, Inject, Module, type INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import Stripe from "stripe";
import { StripeWebhookController } from "../src/modules/payment/presentation/http/stripe-webhook.controller.js";
import { HandleStripeWebhookUseCase } from "../src/modules/payment/application/handle-stripe-webhook.use-case.js";
import { InMemoryPaymentRepository } from "../src/modules/payment/infrastructure/in-memory-payment.repository.js";
import type { ProviderEventKey } from "../src/modules/payment/domain/ports/payment-repository.port.js";
import type { PaymentDispatchService } from "../src/modules/payment/application/services/payment-dispatch.service.js";

// Minimal test host, NOT AppModule. Inherited route and method are unchanged.
@Controller()
class HttpFixtureController extends StripeWebhookController {
  constructor(@Inject(HandleStripeWebhookUseCase) useCase: HandleStripeWebhookUseCase) {
    super(useCase);
  }
}

class ObservedRepository extends InMemoryPaymentRepository {
  reservationCalls = 0;
  async recordProcessedProviderEvent(key: ProviderEventKey): Promise<boolean> {
    this.reservationCalls++;
    return super.recordProcessedProviderEvent(key);
  }
}

const configKeys = ["STRIPE_SECRET_KEY", "STRIPE_SECRET_KEY_TEST", "STRIPE_WEBHOOK_SECRET", "STRIPE_WEBHOOK_SECRET_TEST"] as const;
const previousConfig = configKeys.map(key => process.env[key]);
const secret = "whsec_synthetic_local_http_only";
const stripe = new Stripe("sk_test_synthetic_local_http_only");
const payments = new ObservedRepository();
let app: INestApplication | undefined;
let endpoint: string;

function payload() {
  return JSON.stringify({ id: `evt_${randomUUID()}`, object: "event", type: "synthetic.audit_only",
    livemode: false, data: { object: { description: "Teste de assinatura: ação e café" } } }, null, 2);
}
function signature(body: string, overrides: { secret?: string; timestamp?: number } = {}) {
  return stripe.webhooks.generateTestHeaderString({ payload: body, secret, ...overrides });
}
async function send(body: string, signed?: string, contentType = "application/json") {
  const response = await fetch(endpoint, { method: "POST", redirect: "error",
    headers: { "content-type": contentType, connection: "close", ...(signed === undefined ? {} : { "stripe-signature": signed }) }, body,
    signal: AbortSignal.timeout(5_000) });
  return { status: response.status, body: await response.json() };
}

before(async () => {
  for (const key of configKeys) process.env[key] = key.includes("WEBHOOK") ? secret : "sk_test_synthetic_local_http_only";
  const dispatch = new Proxy({}, { get() { throw new Error("financial_dispatch_forbidden_in_ingress_fixture"); } }) as PaymentDispatchService;
  const useCase = new HandleStripeWebhookUseCase(payments, dispatch);
  @Module({ controllers: [HttpFixtureController], providers: [{ provide: HandleStripeWebhookUseCase, useValue: useCase }] })
  class HttpFixtureModule {}
  app = await NestFactory.create(HttpFixtureModule, { rawBody: true, logger: false });
  app.setGlobalPrefix("v1");
  await app.listen(0, "127.0.0.1");
  const address = app.getHttpServer().address();
  assert.ok(address && typeof address !== "string");
  endpoint = `http://127.0.0.1:${address.port}/v1/webhooks/stripe`;
});

after(async () => {
  try { await app?.close(); } finally {
    configKeys.forEach((key, index) => {
      const value = previousConfig[index];
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    });
  }
});

for (const [name, build] of [
  ["missing signature", (body: string) => ({ body, signed: undefined })],
  ["forged signature", (body: string) => ({ body, signed: "t=1,v1=forged" })],
  ["wrong signing secret", (body: string) => ({ body, signed: signature(body, { secret: "whsec_different_synthetic_secret" }) })],
  ["expired timestamp", (body: string) => ({ body, signed: signature(body, { timestamp: Math.floor(Date.now() / 1000) - 600 }) })],
  ["reformatted JSON bytes", (body: string) => ({ body: JSON.stringify(JSON.parse(body)), signed: signature(body) })],
  ["tampered JSON value", (body: string) => ({ body: body.replace("café", "outro"), signed: signature(body) })],
] as const) {
  test(`HTTP rejects ${name} before event reservation`, async () => {
    const beforeCalls = payments.reservationCalls;
    const request = build(payload());
    const result = await send(request.body, request.signed);
    assert.equal(result.status, 401);
    assert.equal(result.body.message, "stripe_webhook_signature_invalid");
    assert.equal(payments.reservationCalls, beforeCalls);
  });
}

test("HTTP preserves exact signed UTF-8 bytes and returns the real non-financial dispatch result", async () => {
  const body = payload(), beforeCalls = payments.reservationCalls;
  const result = await send(body, signature(body));
  assert.equal(result.status, 200);
  assert.deepEqual(result.body, { outcome: "processed", effect: "ignored_event_type" });
  assert.equal(payments.reservationCalls, beforeCalls + 1);
});

test("HTTP accepts one valid rotated v1 signature alongside an invalid v1", async () => {
  const body = payload();
  const result = await send(body, `${signature(body)},v1=invalid_rotated_signature`);
  assert.equal(result.status, 200);
  assert.equal(result.body.outcome, "processed");
});

test("eight concurrent signed deliveries reserve once and acknowledge all duplicates", async () => {
  const body = payload(), signed = signature(body), beforeCalls = payments.reservationCalls;
  const results = await Promise.all(Array.from({ length: 8 }, () => send(body, signed)));
  assert.ok(results.every(result => result.status === 200));
  assert.equal(results.filter(result => result.body.outcome === "processed").length, 1);
  assert.equal(results.filter(result => result.body.outcome === "duplicate").length, 7);
  assert.equal(payments.reservationCalls, beforeCalls + 8);
  assert.deepEqual(payments.capturedEvents, []);
});

test("wrong content type does not synthesize rawBody or reserve an event", async () => {
  const body = payload(), beforeCalls = payments.reservationCalls;
  const result = await send(body, signature(body), "text/plain");
  assert.equal(result.status, 401);
  assert.equal(result.body.message, "stripe_raw_body_missing");
  assert.equal(payments.reservationCalls, beforeCalls);
});

test("malformed JSON is rejected by the HTTP parser without event reservation", async () => {
  const body = "{broken", beforeCalls = payments.reservationCalls;
  const result = await send(body, signature(body));
  assert.equal(result.status, 400);
  assert.equal(payments.reservationCalls, beforeCalls);
});

test("missing webhook configuration returns 503 without acknowledging or reserving the event", async () => {
  const body = payload(), beforeCalls = payments.reservationCalls;
  const saved = [process.env.STRIPE_WEBHOOK_SECRET, process.env.STRIPE_WEBHOOK_SECRET_TEST];
  delete process.env.STRIPE_WEBHOOK_SECRET;
  delete process.env.STRIPE_WEBHOOK_SECRET_TEST;
  try {
    const result = await send(body, signature(body));
    assert.equal(result.status, 503);
    assert.equal(result.body.message, "stripe_webhook_not_configured");
    assert.equal(payments.reservationCalls, beforeCalls);
  } finally {
    process.env.STRIPE_WEBHOOK_SECRET = saved[0];
    process.env.STRIPE_WEBHOOK_SECRET_TEST = saved[1];
  }
});
