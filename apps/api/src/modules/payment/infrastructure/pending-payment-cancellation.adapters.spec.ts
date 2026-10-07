import assert from "node:assert/strict";
import { test } from "node:test";
import { AsaasPaymentAdapter } from "./asaas-payment.adapter.js";
import { MercadoPagoPaymentAdapter } from "./mercadopago-payment.adapter.js";
import { StripePaymentAdapter } from "./stripe-payment.adapter.js";
import { RoutingPaymentAdapter } from "./routing-payment.adapter.js";
import type { PendingPaymentCancellationInput } from "../domain/pending-payment-cancellation.js";

// Real adapter implementations, simulated HTTP/SDK. This is NOT PSP sandbox evidence.
function setup(provider: "asaas" | "mercadopago" | "stripe") {
  const calls: Array<{ url: string; method: string; init?: RequestInit; args?: unknown }> = [];
  let reads = 0, after: Record<string, unknown> | undefined, failRead = false, failWrite = false;
  const row: any = provider === "asaas" ? { id: "pay_qa", customer: "cus_qa", billingType: "PIX", externalReference: "intent_qa", value: 19.47, status: "PENDING", deleted: false } :
    provider === "mercadopago" ? { id: 1234, external_reference: "intent_qa", currency_id: "BRL", transaction_amount: 19.47, payment_method_id: "pix", status: "pending",
      metadata: { intent_id: "intent_qa", merchant_id: "merchant", session_id: "session" } } :
    { id: "pi_qa", object: "payment_intent", livemode: false, amount: 1947, currency: "brl", status: "requires_action", amount_received: 0, amount_capturable: 0,
      metadata: { intent_id: "intent_qa", merchant_id: "merchant", session_id: "session" } };
  const fetcher: typeof fetch = async (url, init = {}) => {
    const method = init.method ?? "GET"; calls.push({ url: String(url), method, init });
    if (method === "GET") { reads++; if (failRead) return new Response("", { status: 404 }); return Response.json(reads > 1 && after ? { ...row, ...after } : row); }
    if (failWrite) return new Response("", { status: 503 });
    return Response.json(provider === "asaas" ? { id: row.id, deleted: true } : { status: "cancelled" });
  };
  const adapter = provider === "asaas" ? new AsaasPaymentAdapter("https://api-sandbox.asaas.com/v3", "$aact_hmlg_fixture", fetcher) :
    provider === "mercadopago" ? new MercadoPagoPaymentAdapter("https://api.mercadopago.com", "TEST-fixture", undefined, fetcher) : new StripePaymentAdapter("sk_test_fixture", "pk_test_fixture");
  if (adapter instanceof StripePaymentAdapter) (adapter as any).stripe = { paymentIntents: {
    retrieve: async (id: string) => { calls.push({ url: id, method: "GET" }); reads++; if (failRead) throw Error("404"); return reads > 1 && after ? { ...row, ...after } : row; },
    cancel: async (id: string, args: any, options: any) => { calls.push({ url: id, method: "CANCEL", args: { args, options } }); if (failWrite) throw Error("timeout"); return row; },
  } };
  const input: PendingPaymentCancellationInput = { providerPaymentId: String(row.id), idempotencyKey: "cancel_intent_qa", payment: {
    provider, providerAccountFingerprint: adapter.creationAccountFingerprint(), merchantId: "merchant", sessionId: "session", intentId: "intent_qa", amountCents: 1947,
    currency: "BRL", method: provider === "stripe" ? "card" : "pix", ...(provider === "asaas" ? { asaasCustomerId: "cus_qa" } : {}),
  } };
  const router = new RoutingPaymentAdapter(provider === "stripe" ? adapter as StripePaymentAdapter : null, provider === "asaas" ? adapter as AsaasPaymentAdapter : null,
    provider === "mercadopago" ? adapter as MercadoPagoPaymentAdapter : null, {} as never);
  return { adapter, router, input, calls, row, after: (patch: Record<string, unknown>) => { after = patch; }, failRead: () => { failRead = true; }, failWrite: () => { failWrite = true; } };
}

for (const provider of ["asaas", "mercadopago", "stripe"] as const) {
  test(`${provider}: known pending identity uses exact frozen route and GET after mutation`, async () => {
    const f = setup(provider); f.after(provider === "asaas" ? { deleted: true } : { status: provider === "stripe" ? "canceled" : "cancelled" });
    assert.deepEqual(await f.router.cancelPendingPayment(f.input), { state: "cancelled" });
    assert.deepEqual(f.calls.map(c => c.method), ["GET", provider === "asaas" ? "DELETE" : provider === "stripe" ? "CANCEL" : "PUT", "GET"]);
    if (provider === "asaas") assert.ok(f.calls.every(c => c.url === "https://api-sandbox.asaas.com/v3/payments/pay_qa"));
    if (provider === "mercadopago") { assert.equal(f.calls[1]!.init!.body, '{"status":"cancelled"}'); assert.equal(new Headers(f.calls[1]!.init!.headers).get("X-Idempotency-Key"), f.input.idempotencyKey); }
    if (provider === "stripe") assert.deepEqual(f.calls[1]!.args, { args: { cancellation_reason: "requested_by_customer" }, options: { idempotencyKey: f.input.idempotencyKey } });
  });
  test(`${provider}: a successful mutation acknowledgement with still-pending GET does not prove cancellation`, async () => {
    const f = setup(provider); assert.deepEqual(await f.adapter.cancelPendingPayment(f.input), { state: "pending" }); assert.equal(f.calls.length, 3);
  });
  test(`${provider}: remote paid result after cancellation wins and never triggers refund`, async () => {
    const f = setup(provider); f.after({ status: provider === "asaas" ? "RECEIVED" : provider === "stripe" ? "succeeded" : "approved", ...(provider === "stripe" ? { amount_received: 1947 } : {}) });
    assert.deepEqual(await f.adapter.cancelPendingPayment(f.input), { state: "paid" }); assert.equal(f.calls.length, 3);
  });
  test(`${provider}: 404/timeout cannot prove cancellation and cannot cause fallback to a different provider`, async () => {
    const f = setup(provider); f.failRead(); await assert.rejects(f.router.cancelPendingPayment(f.input)); assert.deepEqual(f.calls.map(c => c.method), ["GET"]);
  });
  test(`${provider}: changed credentials, legacy route or marketplace is refused before HTTP/SDK`, async () => {
    const f = setup(provider);
    await assert.rejects(f.router.cancelPendingPayment({ ...f.input, payment: { ...f.input.payment, providerAccountFingerprint: "changed" } }), /account_changed/);
    for (const payment of [{ ...f.input.payment, provider: undefined }, { ...f.input.payment, marketplaceFunding: {} as never }]) {
      assert.deepEqual(await f.router.cancelPendingPayment({ ...f.input, payment }), { state: "unsupported" });
    }
    assert.equal(f.calls.length, 0);
  });
  test(`${provider}: wrong remote identity or amount cannot mutate`, async () => {
    for (const patch of [{ id: "foreign" }, provider === "asaas" ? { value: 19.4701 } : provider === "mercadopago" ? { transaction_amount: 19.4701 } : { amount: 1948 },
      provider === "asaas" ? { externalReference: "other" } : provider === "mercadopago" ? { metadata: { intent_id: "other" } } : { metadata: { intent_id: "other" } }]) {
      const f = setup(provider); Object.assign(f.row, patch); await assert.rejects(f.adapter.cancelPendingPayment(f.input), /identity_mismatch/); assert.equal(f.calls.length, 1);
    }
  });
}
test("Asaas DELETE receipt followed by 404 remains unknown; deleted paid charge is never cancelled", async () => {
  const f = setup("asaas"); f.after({ deleted: true, status: "RECEIVED" });
  assert.deepEqual(await f.adapter.cancelPendingPayment(f.input), { state: "paid" });
  const missing = setup("asaas"); let reads = 0;
  (missing.adapter as any).fetchImpl = async (_url: string, init: RequestInit = {}) => init.method === "DELETE" ? Response.json({ id: "pay_qa", deleted: true }) : ++reads === 1 ? Response.json(missing.row) : new Response("", { status: 404 });
  await assert.rejects(missing.adapter.cancelPendingPayment(missing.input));
});
test("Stripe capture/processing/paid states and Asaas card/subscription are never cancelled", async () => {
  for (const status of ["succeeded", "requires_capture", "processing"]) {
    const f = setup("stripe"); f.row.status = status; assert.ok(["paid", "unavailable"].includes((await f.adapter.cancelPendingPayment(f.input)).state)); assert.equal(f.calls.length, 1);
  }
  for (const patch of [{ amount_capturable: 1 }, { amount_received: 1 }]) {
    const f = setup("stripe"); Object.assign(f.row, patch); assert.equal((await f.adapter.cancelPendingPayment(f.input)).state, "paid"); assert.equal(f.calls.length, 1);
  }
  const f = setup("asaas"); f.row.subscription = "subscription"; assert.equal((await f.adapter.cancelPendingPayment(f.input)).state, "unsupported"); assert.equal(f.calls.length, 1);
  f.input.payment.method = "card"; assert.equal((await f.adapter.cancelPendingPayment(f.input)).state, "unsupported"); assert.equal(f.calls.length, 1);
});
test("Stripe direct_v2 reads and cancels only the frozen connected account; destination keeps platform ownership", async () => {
  const f = setup("stripe"), calls: any[] = [];
  f.input.payment.stripeChargeMode = "direct_v2"; f.input.payment.stripeConnectAccountId = "acct_original";
  let cancelled = false;
  (f.adapter as any).stripe = { paymentIntents: {
    retrieve: async (id: string, args: any, options: any) => { calls.push({ id, args, options }); return { ...f.row, status: cancelled ? "canceled" : "requires_action" }; },
    cancel: async (id: string, args: any, options: any) => { calls.push({ id, args, options }); cancelled = true; return f.row; },
  } };
  assert.equal((await f.adapter.cancelPendingPayment(f.input)).state, "cancelled");
  assert.ok(calls.every(call => call.options.stripeAccount === "acct_original"));
  assert.equal(calls[1].options.idempotencyKey, f.input.idempotencyKey);
  const missing = setup("stripe"); missing.input.payment.stripeChargeMode = "direct_v2";
  await assert.rejects(missing.adapter.cancelPendingPayment(missing.input), /identity_invalid/); assert.equal(missing.calls.length, 0);
});
