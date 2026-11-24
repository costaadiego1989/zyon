import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { PaymentIntentEntity } from "../domain/payment-intent.entity.js";
import { InMemoryPaymentRepository } from "../infrastructure/in-memory-payment.repository.js";
import { MercadoPagoPaymentAdapter } from "../infrastructure/mercadopago-payment.adapter.js";
import { HandleMercadoPagoWebhookUseCase } from "./handle-mercadopago-webhook.use-case.js";
import { PaymentDispatchService } from "./services/payment-dispatch.service.js";
import type { CheckoutPaymentApprovedInput, CheckoutPaymentPort } from "../domain/ports/checkout-payment.port.js";

// Component boundary only: real adapter + signature + handler + dispatch/domain,
// synthetic HTTP transport and in-memory persistence. Not AppModule/SQL proof.
const paymentId = "mp_observed_payment";
const secret = "synthetic-observed-approval-secret";
const requestId = "observed-approval-request";
function signed() {
  const ts = "1720000000";
  const rawBody = JSON.stringify({ action: "payment.updated", data: { id: paymentId } });
  const digest = createHmac("sha256", secret).update(`id:${paymentId};request-id:${requestId};ts:${ts};`).digest("hex");
  return { rawBody, signature: `ts=${ts},v1=${digest}` };
}
async function fixture(change: (value: Record<string, unknown>) => void = () => {}) {
  const payments = new InMemoryPaymentRepository();
  const approvals: CheckoutPaymentApprovedInput[] = [];
  const failures: unknown[] = [];
  const checkout: CheckoutPaymentPort = {
    async completeAfterApproval(value) { approvals.push(value); },
    async recordPaymentFailure(value) { failures.push(value); },
    async recordPaymentStatusChanged(value) { failures.push(value); },
  };
  const intent = PaymentIntentEntity.create({ merchantId: "merchant_observed", sessionId: "checkout_observed",
    idempotencyKey: "idem_observed", amountCents: 10_000, currency: "BRL", method: "pix" });
  intent.prepareCreation({ provider: "mercadopago", merchantId: "merchant_observed", sessionId: "checkout_observed",
    intentId: intent.id, amountCents: 10_000, currency: "BRL", method: "pix" });
  intent.markRequiresAction({ providerPaymentId: paymentId });
  await payments.saveIntent({ intent });
  const before = (await payments.getIntentById("merchant_observed", intent.id))!.snapshot();
  const observed: Record<string, unknown> = { id: paymentId, status: "approved", transaction_amount: 100,
    currency_id: "BRL", external_reference: intent.id };
  change(observed);
  let reads = 0;
  const fetcher = (async (url, init) => {
    reads++;
    assert.equal(String(url), `https://mp-observed.invalid/v1/payments/${paymentId}`);
    assert.equal(new Headers(init?.headers).get("authorization"), "Bearer synthetic-token");
    return Response.json(observed);
  }) as typeof fetch;
  const adapter = new MercadoPagoPaymentAdapter("https://mp-observed.invalid", "synthetic-token", undefined, fetcher);
  const useCase = new HandleMercadoPagoWebhookUseCase(payments, new PaymentDispatchService(payments, checkout), undefined, adapter);
  const webhook = signed();
  return { payments, approvals, failures, intent, before, observed,
    execute: () => useCase.execute(webhook.rawBody, webhook.signature, requestId, secret), reads: () => reads };
}

const refusals: Array<[string, (value: Record<string, unknown>) => void]> = [
  ["lower observed amount", value => { value.transaction_amount = 99.99; }],
  ["higher observed amount", value => { value.transaction_amount = 100.01; }],
  ["missing observed amount", value => { delete value.transaction_amount; }],
  ["nonfinite observed amount", value => { value.transaction_amount = Infinity; }],
  ["fractional cent observed amount", value => { value.transaction_amount = 100.0001; }],
  ["different observed currency", value => { value.currency_id = "USD"; }],
  ["missing observed currency", value => { delete value.currency_id; }],
  ["different observed external reference", value => { value.external_reference = "foreign_intent"; }],
  ["missing observed external reference", value => { delete value.external_reference; }],
  ["different observed payment ID", value => { value.id = "foreign_payment"; }],
  ["missing observed payment ID", value => { delete value.id; }],
];
for (const [name, change] of refusals) {
  test(`Mercado Pago signed approval rejects ${name} before reserving or completing`, async () => {
    const f = await fixture(change);
    await assert.rejects(f.execute, /mercadopago_(webhook|payment)_/);
    assert.equal(f.reads(), 1);
    assert.deepEqual((await f.payments.getIntentById("merchant_observed", f.intent.id))!.snapshot(), f.before);
    assert.deepEqual(f.approvals, []);
    assert.deepEqual(f.failures, []);
    assert.equal(await f.payments.hasProcessedProviderEvent({ provider: "mercadopago", merchantId: "merchant_observed",
      eventId: `${paymentId}:approved` }), false);
  });
}

test("Mercado Pago matching observed amount currency and identity approves exactly once", async () => {
  const f = await fixture();
  assert.deepEqual(await f.execute(), { outcome: "processed", effect: "checkout_completed_after_payment" });
  assert.deepEqual(await f.execute(), { outcome: "duplicate" });
  assert.equal(f.approvals.length, 1);
  assert.equal(f.approvals[0].orderTotalMajorUnits, 100);
  assert.equal(f.approvals[0].currency, "BRL");
  const stored = (await f.payments.getIntentById("merchant_observed", f.intent.id))!.snapshot();
  assert.equal(stored.status, "approved");
  assert.equal(stored.approvedAmountCents, 10_000);
  assert.equal(stored.providerPaymentId, paymentId);
});

test("Mercado Pago pending notification remains informational without approval financial facts", async () => {
  const f = await fixture(value => { value.status = "pending"; delete value.transaction_amount;
    delete value.currency_id; delete value.external_reference; });
  assert.deepEqual(await f.execute(), { outcome: "processed", effect: "noop_payment_pending_or_unknown" });
  assert.deepEqual((await f.payments.getIntentById("merchant_observed", f.intent.id))!.snapshot(), f.before);
  assert.deepEqual(f.approvals, []);
  assert.deepEqual(f.failures, []);
});
// Additive component coverage. The thirteen original cases above stay byte
// exact. Raw JSON values here exercise the real adapter parser; signed cases
// also retain the real HMAC/handler/domain/event-before-effect guards.
async function decimalObservation(value: unknown, extra: Record<string, unknown> = {}) {
  let reads = 0;
  const fetcher = (async (url, init) => {
    reads++;
    assert.equal(String(url), "https://mp-decimal.invalid/v1/payments/12345");
    assert.equal(new Headers(init?.headers).get("authorization"), "Bearer synthetic-decimal-token");
    // Preserve even nonfinite/hostile values so the adapter cannot accidentally
    // accept them through serialization or Number()/parseFloat() coercion.
    return { ok: true, json: async () => ({ id: 12345, status: "approved", transaction_amount: value,
      currency_id: "BRL", external_reference: "observed-decimal-intent", ...extra }) } as Response;
  }) as typeof fetch;
  const adapter = new MercadoPagoPaymentAdapter("https://mp-decimal.invalid", "synthetic-decimal-token", undefined, fetcher);
  const result = await adapter.fetchPaymentStatus({ merchantId: "observed-decimal-merchant", providerPaymentId: "12345" });
  assert.equal(reads, 1); return result;
}
const decimalAccepts: Array<[string, unknown, number]> = [
  ["documented decimal string", "24.50", 2450],
  ["JSON number", 24.5, 2450],
  ["integer string", "24", 2400],
  ["one decimal digit", "24.5", 2450],
  ["leading decimal zeroes", "00024.50", 2450],
  ["exact trailing zeroes", "24.5000", 2450],
  ["long exact zero scale within bound", "24.500000000000000000000000000", 2450],
  ["one-cent number", 0.01, 1],
  ["one-cent string", "0.01", 1],
  ["binary floating decimal 0.29", 0.29, 29],
  ["binary floating decimal 1.23", 1.23, 123],
  ["binary floating decimal 98.04", 98.04, 9804],
  ["multi-digit major units", "1234567.89", 123456789],
  ["largest exact safe cent string", "90071992547409.91", Number.MAX_SAFE_INTEGER],
  ["large representable JSON number uses its observed decimal value", 90071992547409.9, 9007199254740990],
];
const decimalRefuses: Array<[string, unknown]> = [
  ["missing", undefined], ["null", null], ["boolean true", true], ["boolean false", false],
  ["array", []], ["numeric array", [24.5]], ["object", {}], ["coercible object", { valueOf: () => 24.5 }],
  ["zero", 0], ["negative zero", -0], ["negative number", -24.5],
  ["NaN", NaN], ["positive infinity", Infinity], ["negative infinity", -Infinity],
  ["sub-cent number", 0.001], ["fractional-cent number", 24.501],
  ["small nonzero fractional-cent tail", 24.50000000001], ["binary arithmetic sub-cent tail", 0.1 + 0.2],
  ["overflowing major-unit number", Number.MAX_SAFE_INTEGER],
  ["empty string", ""], ["blank string", " "], ["leading whitespace", " 24.50"], ["trailing whitespace", "24.50 "],
  ["positive sign", "+24.50"], ["negative string", "-24.50"], ["zero integer string", "0"], ["zero decimal string", "0.00"],
  ["localized comma", "24,50"], ["currency text", "R$ 24.50"], ["scientific string", "2.45e1"], ["hex string", "0x18"],
  ["partial numeric text", "24.50garbage"], ["NaN text", "NaN"], ["infinity text", "Infinity"],
  ["missing major digits", ".50"], ["missing fractional digits", "24."],
  ["sub-cent string", "0.001"], ["nonzero string tail lost by Number coercion", "24.5000000000000001"],
  ["one cent over safe integer", "90071992547409.92"], ["overflow integer string", "100000000000000"],
  ["bounded parse rejects excessive input", "0".repeat(33) + "24.50"],
];

test("Mercado Pago exact observed decimal formats retain financial admission guards", async t => {
  for (const [name, value, expectedCents] of decimalAccepts) await t.test("accepts " + name, async () => {
    const result = await decimalObservation(value);
    assert.deepEqual(result, { state: "approved", approvedAmountCents: expectedCents, currency: "BRL", externalReference: "observed-decimal-intent" });
    assert.equal(Number.isSafeInteger(result.approvedAmountCents), true);
  });
  for (const [name, value] of decimalRefuses) await t.test("refuses " + name + " without manufacturing approval amount", async () => {
    const result = await decimalObservation(value);
    assert.equal(result.state, "approved"); assert.equal(result.approvedAmountCents, undefined);
    assert.equal(result.currency, "BRL"); assert.equal(result.externalReference, "observed-decimal-intent");
  });
  for (const value of ["100", "100.0", "100.00", "000100.00000000000000000000"]) await t.test("signed matching string " + value + " approves once", async () => {
    const f = await fixture(observed => { observed.transaction_amount = value; });
    assert.deepEqual(await f.execute(), { outcome: "processed", effect: "checkout_completed_after_payment" });
    assert.deepEqual(await f.execute(), { outcome: "duplicate" }); assert.equal(f.approvals.length, 1);
    assert.equal(f.approvals[0].orderTotalMajorUnits, 100); assert.equal(f.approvals[0].currency, "BRL");
    const stored = (await f.payments.getIntentById("merchant_observed", f.intent.id))!.snapshot();
    assert.equal(stored.status, "approved"); assert.equal(stored.approvedAmountCents, 10_000);
    assert.equal(stored.providerPaymentId, paymentId); assert.deepEqual(f.failures, []);
  });
  await t.test("legitimate string amounts do not bypass amount currency reference or payment identity", async () => {
    for (const patch of [{ transaction_amount: "99.99" }, { transaction_amount: "100.01" }, { transaction_amount: "100.0000000000000001" },
      { currency_id: "USD" }, { currency_id: undefined }, { external_reference: "foreign_intent" }, { external_reference: undefined },
      { id: "foreign_payment" }, { id: undefined }]) {
      const f = await fixture(observed => Object.assign(observed, { transaction_amount: "100.00" }, patch));
      await assert.rejects(f.execute, /mercadopago_(webhook|payment)_/); assert.equal(f.reads(), 1);
      assert.deepEqual((await f.payments.getIntentById("merchant_observed", f.intent.id))!.snapshot(), f.before);
      assert.deepEqual(f.approvals, []); assert.deepEqual(f.failures, []);
      assert.equal(await f.payments.hasProcessedProviderEvent({ provider: "mercadopago", merchantId: "merchant_observed", eventId: `${paymentId}:approved` }), false);
    }
  });
  await t.test("pending and chargeback mapping retain their original numeric observation behavior", async () => {
    const pending = await decimalObservation("24.50", { status: "pending" });
    assert.equal(pending.state, "pending"); assert.equal(pending.approvedAmountCents, undefined);
    const chargedBack = await decimalObservation(24.5, { status: "charged_back", status_detail: "settled" });
    assert.equal(chargedBack.state, "chargeback_lost"); assert.equal(chargedBack.approvedAmountCents, 2450);
    const unchangedString = await decimalObservation("24.50", { status: "charged_back", status_detail: "reimbursed" });
    assert.equal(unchangedString.state, "chargeback_won"); assert.equal(unchangedString.approvedAmountCents, undefined);
  });
});
