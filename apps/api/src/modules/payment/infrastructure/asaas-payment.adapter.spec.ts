import test from "node:test";
import assert from "node:assert/strict";
import { AsaasPaymentAdapter } from "./asaas-payment.adapter.js";
import type { CreateProviderPaymentInput } from "../domain/ports/payment-provider.port.js";

const API_BASE = "https://sandbox.asaas.com";
const API_KEY = "test_api_key_secret";

function makePixInput(overrides: Partial<CreateProviderPaymentInput> = {}): CreateProviderPaymentInput {
  return {
    merchantId: "merchant_123",
    sessionId: "session_abc",
    intentId: "intent_xyz",
    amountCents: 15000,
    currency: "BRL",
    method: "pix",
    asaasCustomerId: "cus_000005113026",
    description: "Test checkout",
    ...overrides
  };
}

function makeCardInput(overrides: Partial<CreateProviderPaymentInput> = {}): CreateProviderPaymentInput {
  return {
    ...makePixInput(),
    method: "card",
    creditCard: {
      holderName: "João da Silva",
      number: "4111 1111 1111 1111",
      expiryMonth: "12",
      expiryYear: "2030",
      ccv: "123"
    },
    creditCardHolderInfo: {
      name: "João da Silva",
      email: "joao@example.com",
      cpfCnpj: "123.456.789-00",
      postalCode: "01001-000",
      addressNumber: "100",
      phone: "(11) 99999-8888"
    },
    remoteIp: "189.44.100.50",
    ...overrides
  };
}

function createMockFetch(responses: Array<{ ok: boolean; status: number; body: any }>) {
  let callIndex = 0;
  const calls: Array<{ url: string; init: any }> = [];
  const fn = async (url: string, init?: any) => {
    calls.push({ url, init });
    const resp = responses[callIndex] ?? responses[responses.length - 1];
    callIndex++;
    return {
      ok: resp.ok,
      status: resp.status,
      json: async () => resp.body,
      text: async () => JSON.stringify(resp.body)
    };
  };
  return { fn: fn as unknown as typeof fetch, calls };
}

// ── PIX tests ──

test("PIX: should create payment and fetch QR code", async () => {
  const { fn, calls } = createMockFetch([
    { ok: true, status: 200, body: { id: "pay_pix_001", status: "PENDING", invoiceUrl: "https://asaas.com/i/pay_pix_001" } },
    { ok: true, status: 200, body: { payload: "000201...PIX_PAYLOAD", encodedImage: "base64image==" } }
  ]);

  const adapter = new AsaasPaymentAdapter(API_BASE, API_KEY, fn);
  const result = await adapter.createPayment(makePixInput());

  assert.equal(result.providerPaymentId, "pay_pix_001");
  assert.equal(result.status, "requires_action");
  assert.equal(result.buyerFacingPayload.qrCodeCopyPaste, "000201...PIX_PAYLOAD");
  assert.equal(result.buyerFacingPayload.encodedQrImage, "base64image==");
  assert.equal(calls.length, 2);

  const paymentBody = JSON.parse(calls[0].init.body);
  assert.equal(paymentBody.billingType, "PIX");
  assert.equal(paymentBody.creditCardToken, undefined);
});

test("PIX: should return requires_action even if QR code fetch fails", async () => {
  const { fn } = createMockFetch([
    { ok: true, status: 200, body: { id: "pay_pix_002", status: "PENDING" } },
    { ok: false, status: 500, body: {} }
  ]);

  const adapter = new AsaasPaymentAdapter(API_BASE, API_KEY, fn);
  const result = await adapter.createPayment(makePixInput());

  assert.equal(result.providerPaymentId, "pay_pix_002");
  assert.equal(result.status, "requires_action");
  assert.equal(result.buyerFacingPayload.qrCodeCopyPaste, undefined);
});

// ── Credit card tokenization tests ──

test("Card: should tokenize first, then create payment with token only", async () => {
  const { fn, calls } = createMockFetch([
    { ok: true, status: 200, body: { creditCardToken: "tok_abc123_secure", creditCardNumber: "1111" } },
    { ok: true, status: 200, body: { id: "pay_card_001", status: "CONFIRMED", invoiceUrl: "https://asaas.com/i/c" } }
  ]);

  const adapter = new AsaasPaymentAdapter(API_BASE, API_KEY, fn);
  const result = await adapter.createPayment(makeCardInput());

  assert.equal(result.providerPaymentId, "pay_card_001");
  assert.equal(result.status, "pending"); // CONFIRMED → pending
  assert.equal(calls.length, 2);

  // 1st call: tokenization
  assert.ok(calls[0].url.includes("/v3/creditCard/tokenize"));
  const tokenizeBody = JSON.parse(calls[0].init.body);
  assert.equal(tokenizeBody.creditCard.number, "4111111111111111"); // spaces stripped
  assert.equal(tokenizeBody.creditCardHolderInfo.cpfCnpj, "12345678900"); // non-digits stripped
  assert.equal(tokenizeBody.creditCardHolderInfo.postalCode, "01001000");
  assert.equal(tokenizeBody.remoteIp, "189.44.100.50");

  // 2nd call: payment — token only, no raw card data
  const paymentBody = JSON.parse(calls[1].init.body);
  assert.equal(paymentBody.creditCardToken, "tok_abc123_secure");
  assert.equal(paymentBody.creditCard, undefined);
  assert.equal(paymentBody.billingType, "CREDIT_CARD");
});

test("Card: should throw if tokenization fails", async () => {
  const { fn } = createMockFetch([
    { ok: false, status: 400, body: { errors: [{ description: "Invalid card" }] } }
  ]);

  const adapter = new AsaasPaymentAdapter(API_BASE, API_KEY, fn);
  await assert.rejects(adapter.createPayment(makeCardInput()), /asaas_tokenize_failed:400/);
});

test("Card: should throw if tokenization returns no token", async () => {
  const { fn } = createMockFetch([
    { ok: true, status: 200, body: {} }
  ]);

  const adapter = new AsaasPaymentAdapter(API_BASE, API_KEY, fn);
  await assert.rejects(adapter.createPayment(makeCardInput()), /asaas_tokenize_missing_token/);
});

test("Card: should throw if payment creation after tokenization fails", async () => {
  const { fn } = createMockFetch([
    { ok: true, status: 200, body: { creditCardToken: "tok_valid" } },
    { ok: false, status: 500, body: { errors: [{ description: "Internal error" }] } }
  ]);

  const adapter = new AsaasPaymentAdapter(API_BASE, API_KEY, fn);
  await assert.rejects(adapter.createPayment(makeCardInput()), /asaas_payment_create_failed:500/);
});

test("Card: should strip sensitive characters from holder info fields", async () => {
  const { fn, calls } = createMockFetch([
    { ok: true, status: 200, body: { creditCardToken: "tok_clean" } },
    { ok: true, status: 200, body: { id: "pay_clean", status: "RECEIVED" } }
  ]);

  const adapter = new AsaasPaymentAdapter(API_BASE, API_KEY, fn);
  await adapter.createPayment(makeCardInput({
    creditCardHolderInfo: {
      name: "Maria Teste",
      email: "maria@test.com",
      cpfCnpj: "987.654.321-00",
      postalCode: "12345-678",
      addressNumber: "42A",
      phone: "+55 (21) 98765-4321"
    }
  }));

  const tokenizeBody = JSON.parse(calls[0].init.body);
  assert.equal(tokenizeBody.creditCardHolderInfo.cpfCnpj, "98765432100");
  assert.equal(tokenizeBody.creditCardHolderInfo.postalCode, "12345678");
  assert.equal(tokenizeBody.creditCardHolderInfo.phone, "5521987654321");
});

// ── Security guarantees ──

test("Security: payment body must never contain raw card data", async () => {
  const { fn, calls } = createMockFetch([
    { ok: true, status: 200, body: { creditCardToken: "tok_sec" } },
    { ok: true, status: 200, body: { id: "pay_sec", status: "CONFIRMED" } }
  ]);

  const adapter = new AsaasPaymentAdapter(API_BASE, API_KEY, fn);
  await adapter.createPayment(makeCardInput());

  const paymentBody = JSON.parse(calls[1].init.body);
  assert.equal(paymentBody.creditCard, undefined);
  assert.equal(paymentBody.creditCardHolderInfo, undefined);
  assert.equal(paymentBody.creditCardToken, "tok_sec");
});

test("Security: should use access_token header, not Bearer authorization", async () => {
  const { fn, calls } = createMockFetch([
    { ok: true, status: 200, body: { id: "pay_hdr", status: "PENDING" } },
    { ok: true, status: 200, body: {} }
  ]);

  const adapter = new AsaasPaymentAdapter(API_BASE, API_KEY, fn);
  await adapter.createPayment(makePixInput());

  const headers = calls[0].init.headers;
  assert.equal(headers.access_token, API_KEY);
  assert.equal(headers.Authorization, undefined);
});
