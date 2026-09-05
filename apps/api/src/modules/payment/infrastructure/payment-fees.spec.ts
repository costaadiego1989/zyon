import test from "node:test";
import assert from "node:assert/strict";
import { AsaasPaymentAdapter } from "./asaas-payment.adapter.js";
import { MercadoPagoPaymentAdapter } from "./mercadopago-payment.adapter.js";
import { merchantTransactionFeeCentsFor } from "../domain/billing-plans.js";
import type { CreateProviderPaymentInput } from "../domain/ports/payment-provider.port.js";

const input: CreateProviderPaymentInput = {
  merchantId: "m_test", sessionId: "session", intentId: "intent", providerIdempotencyKey: "stable-key",
  amountCents: 10099, currency: "BRL", method: "pix", asaasCustomerId: "customer",
  platformFeeCents: 99 + merchantTransactionFeeCentsFor({ status: "starter", planKey: "starter" }),
};

test("Asaas splits R$2.99 merchant fee plus existing buyer fee only on the created payment", async () => {
  let body: any;
  const fetcher = (async (url: string, init?: RequestInit) => {
    if (url.endsWith("/payments")) { body = JSON.parse(String(init?.body)); return new Response(JSON.stringify({ id: "pay_test", status: "PENDING" })); }
    return new Response(JSON.stringify({ payload: "pix-code" }));
  }) as typeof fetch;
  const adapter = new AsaasPaymentAdapter("https://asaas.example.test", "fake-key", fetcher, "platform-wallet");
  await adapter.createPayment(input);
  assert.deepEqual(body.split, [{ walletId: "platform-wallet", fixedValue: 3.98 }]);
  assert.equal(body.value, 100.99);
});

test("Mercado Pago seller OAuth payment carries application fee and stable idempotency", async () => {
  let body: any;
  let headers: Headers;
  const fetcher = (async (_url: string, init?: RequestInit) => {
    body = JSON.parse(String(init?.body)); headers = new Headers(init?.headers);
    return new Response(JSON.stringify({ id: 123, status: "pending" }));
  }) as typeof fetch;
  await new MercadoPagoPaymentAdapter("https://mp.example.test", "seller-token", "", fetcher, true).createPayment(input);
  assert.equal(body.application_fee, 3.98);
  assert.equal(body.transaction_amount, 100.99);
  assert.equal(headers!.get("X-Idempotency-Key"), "stable-key");
});

test("Mercado Pago platform-owned credentials do not create a seller OAuth split", async () => {
  let body: any;
  const fetcher = (async (_url: string, init?: RequestInit) => { body = JSON.parse(String(init?.body)); return new Response(JSON.stringify({ id: 123 })); }) as typeof fetch;
  await new MercadoPagoPaymentAdapter("https://mp.example.test", "platform-token", "", fetcher).createPayment(input);
  assert.equal(body.application_fee, undefined);
});
