import test from "node:test";
import assert from "node:assert/strict";
import { AsaasPaymentAdapter, maximumAsaasProviderFeeCents } from "./asaas-payment.adapter.js";
import { MercadoPagoPaymentAdapter } from "./mercadopago-payment.adapter.js";
import { merchantTransactionFeeCentsFor } from "../domain/billing-plans.js";
import type { CreateProviderPaymentInput } from "../domain/ports/payment-provider.port.js";

const input: CreateProviderPaymentInput = {
  merchantId: "m_test", sessionId: "session", intentId: "intent", providerIdempotencyKey: "stable-key",
  amountCents: 10099, currency: "BRL", method: "pix", asaasCustomerId: "customer",
  platformFeeCents: 99 + merchantTransactionFeeCentsFor({ status: "starter", planKey: "starter" }),
};

const maximumPixProviderFeeCents = () => 99;

test("Asaas fixed split guard uses the public standard fee envelope when no override is set", () => {
  assert.equal(maximumAsaasProviderFeeCents({ amountCents: 10_000, method: "pix" }, {}), 199);
  assert.equal(maximumAsaasProviderFeeCents({ amountCents: 10_000, method: "boleto" }, {}), 199);
  assert.equal(maximumAsaasProviderFeeCents({ amountCents: 10_000, method: "card" }, {}), 478);
});

test("Asaas fixed split guard uses a complete account-specific fee override", () => {
  assert.equal(maximumAsaasProviderFeeCents({ amountCents: 10_000, method: "pix" }, {
    ASAAS_PLATFORM_SPLIT_MAX_PROVIDER_FEE_PIX_FIXED_CENTS: "250",
    ASAAS_PLATFORM_SPLIT_MAX_PROVIDER_FEE_PIX_BPS: "35",
  }), 285);
});

test("Asaas splits R$2.99 merchant fee plus existing buyer fee only on the created payment", async () => {
  let body: any;
  const fetcher = (async (url: string, init?: RequestInit) => {
    if (url.endsWith("/payments")) { body = JSON.parse(String(init?.body)); return new Response(JSON.stringify({ id: "pay_test", status: "PENDING" })); }
    return new Response(JSON.stringify({ payload: "pix-code" }));
  }) as typeof fetch;
  const adapter = new AsaasPaymentAdapter("https://asaas.example.test", "fake-key", fetcher, "platform-wallet", false, maximumPixProviderFeeCents);
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

test("seller Asaas charge fails before network when the platform wallet is absent", async () => {
  const adapter = new AsaasPaymentAdapter("https://asaas.example.test", "seller-key", (() => { throw new Error("network must not run"); }) as typeof fetch, undefined, true);
  await assert.rejects(() => adapter.createPayment(input), /asaas_platform_wallet_not_configured/);
});

test("Asaas fixed split fails before network when an injected provider-fee envelope is unavailable", async () => {
  const adapter = new AsaasPaymentAdapter(
    "https://asaas.example.test",
    "seller-key",
    (() => { throw new Error("network must not run"); }) as typeof fetch,
    "platform-wallet",
    true,
    () => undefined,
  );
  await assert.rejects(() => adapter.createPayment(input), /asaas_platform_split_net_value_guard_not_configured/);
});

test("Asaas fixed split fails before network when the maximum provider deduction leaves insufficient net value", async () => {
  const adapter = new AsaasPaymentAdapter(
    "https://asaas.example.test",
    "seller-key",
    (() => { throw new Error("network must not run"); }) as typeof fetch,
    "platform-wallet",
    true,
    () => 9_800,
  );
  await assert.rejects(() => adapter.createPayment(input), /asaas_platform_split_may_exceed_net_value/);
});

test("seller Mercado Pago charge cannot collect a platform fee without OAuth", async () => {
  const adapter = new MercadoPagoPaymentAdapter("https://mp.example.test", "seller-key", "", (() => { throw new Error("network must not run"); }) as typeof fetch, false, true);
  await assert.rejects(() => adapter.createPayment(input), /mercadopago_oauth_required_for_platform_fee/);
});
