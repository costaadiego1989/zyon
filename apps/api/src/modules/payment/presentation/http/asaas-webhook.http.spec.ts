import "reflect-metadata";
import { test } from "node:test";
import assert from "node:assert/strict";
import { Module, ServiceUnavailableException } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { AsaasWebhookController } from "./asaas-webhook.controller.js";
import { AsaasBillingWebhookController } from "./asaas-billing-webhook.controller.js";
import { HandleAsaasWebhookUseCase, assertWebhookToken } from "../../application/handle-asaas-webhook.use-case.js";
import { HandleAsaasTransferWebhookUseCase } from "../../application/handle-asaas-transfer-webhook.use-case.js";
import { HandleAsaasBillingWebhookUseCase } from "../../application/payment-platform/billing/handle-asaas-billing-webhook.use-case.js";

test("Asaas HTTP delivery contract: exact 200 for success, 401 for invalid tokens, failures remain retryable", async (t) => {
  const previousToken = process.env.ASAAS_WEBHOOK_TOKEN;
  const token = "test-asaas-http-contract-secret-20261006";
  process.env.ASAAS_WEBHOOK_TOKEN = token;
  t.after(() => {
    if (previousToken === undefined) delete process.env.ASAAS_WEBHOOK_TOKEN;
    else process.env.ASAAS_WEBHOOK_TOKEN = previousToken;
  });

  // The source-test loader omits decorator type metadata. Supply the same
  // constructor metadata that the production TypeScript build emits.
  Reflect.defineMetadata("design:paramtypes", [HandleAsaasWebhookUseCase, HandleAsaasTransferWebhookUseCase], AsaasWebhookController);
  Reflect.defineMetadata("design:paramtypes", [HandleAsaasBillingWebhookUseCase], AsaasBillingWebhookController);

  const handlePayment = {
    execute: async (header: string | undefined, body: { outcome?: string; fail?: boolean }) => {
      assertWebhookToken(token, header);
      if (body.fail) throw new ServiceUnavailableException("retry_payment_processing");
      return { outcome: body.outcome ?? "processed" };
    },
  };
  const handleTransfer = {
    execute: async (header: string | undefined) => {
      assertWebhookToken(token, header);
      return { outcome: "processed", effect: "transfer_reconciled" };
    },
  };
  const handleBilling = {
    execute: async (input: { event: string }) => {
      if (input.event === "FAIL") throw new ServiceUnavailableException("retry_billing_processing");
      return { outcome: input.event === "IGNORE" ? "ignored" : input.event === "DUPLICATE" ? "duplicate" : "processed" };
    },
  };

  @Module({
    controllers: [AsaasWebhookController, AsaasBillingWebhookController],
    providers: [
      { provide: HandleAsaasWebhookUseCase, useValue: handlePayment },
      { provide: HandleAsaasTransferWebhookUseCase, useValue: handleTransfer },
      { provide: HandleAsaasBillingWebhookUseCase, useValue: handleBilling },
    ],
  })
  class WebhookHttpTestModule {}

  const app = await NestFactory.create(WebhookHttpTestModule, { logger: false });
  t.after(() => app.close());
  await app.listen(0, "127.0.0.1");
  const base = await app.getUrl();
  const post = (path: string, body: unknown, auth: string | undefined = token) => fetch(`${base}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(auth ? { "asaas-access-token": auth } : {}) },
    body: JSON.stringify(body),
  });

  for (const outcome of ["processed", "duplicate", "ignored"]) {
    const payment = await post("/webhooks/asaas", { outcome });
    assert.equal(payment.status, 200, `payment ${outcome} must acknowledge with exact HTTP 200`);
    assert.equal((await payment.json() as { outcome: string }).outcome, outcome);
    const billing = await post("/webhooks/asaas/billing", { event: outcome === "ignored" ? "IGNORE" : outcome === "duplicate" ? "DUPLICATE" : "PAYMENT_RECEIVED" });
    assert.equal(billing.status, 200, `billing ${outcome} must acknowledge with exact HTTP 200`);
    assert.equal((await billing.json() as { outcome: string }).outcome, outcome);
  }
  const transfer = await post("/webhooks/asaas", { event: "TRANSFER_DONE" });
  assert.equal(transfer.status, 200);
  assert.equal((await transfer.json() as { effect: string }).effect, "transfer_reconciled");
  for (const path of ["/webhooks/asaas", "/webhooks/asaas/billing"]) {
    assert.equal((await post(path, {}, "invalid-token")).status, 401);
    assert.equal((await post(path, {}, "")).status, 401);
  }
  assert.equal((await post("/webhooks/asaas", { fail: true })).status, 503);
  assert.equal((await post("/webhooks/asaas/billing", { event: "FAIL" })).status, 503);
});
