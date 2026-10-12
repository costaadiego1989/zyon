import test from "node:test";
import assert from "node:assert/strict";
import { AsaasPaymentAdapter } from "./asaas-payment.adapter.js";
import { MercadoPagoPaymentAdapter } from "./mercadopago-payment.adapter.js";
import { StripePaymentAdapter } from "./stripe-payment.adapter.js";

const input = { merchantId: "qa", providerPaymentId: "pay_qa" };
function transport(bodies: unknown[]) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fetcher = async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init }); return Response.json(bodies.shift());
  };
  return { calls, fetcher: fetcher as typeof fetch };
}

test("Asaas verifies removal and unpaid status after DELETE, rather than treating deletion as refund", async () => {
  const f = transport([{ status: "PENDING" }, { deleted: true }, { deleted: true, status: "PENDING" }]);
  assert.deepEqual(await new AsaasPaymentAdapter("https://api-sandbox.asaas.com", "fixture", f.fetcher).cancelPayment(input), { state: "cancelled" });
  assert.deepEqual(f.calls.map(call => call.init?.method ?? "GET"), ["GET", "DELETE", "GET"]);
});
for (const status of ["RECEIVED", "CONFIRMED", "RECEIVED_IN_CASH"]) test(`Asaas paid ${status} charge is blocked even if already deleted`, async () => {
  const f = transport([{ status, deleted: true }]);
  assert.deepEqual(await new AsaasPaymentAdapter("https://api-sandbox.asaas.com", "fixture", f.fetcher).cancelPayment(input), { state: "blocked" });
  assert.equal(f.calls.length, 1);
});
test("Asaas approval racing with deletion prevents another charge", async () => {
  const f = transport([{ status: "PENDING" }, { deleted: true }, { deleted: true, status: "RECEIVED" }]);
  assert.deepEqual(await new AsaasPaymentAdapter("https://api-sandbox.asaas.com", "fixture", f.fetcher).cancelPayment(input), { state: "blocked" });
});
test("Mercado Pago cancellation confirms a numeric pending payment; hosted preferences stay blocked", async () => {
  const f = transport([{ status: "pending" }, { status: "cancelled" }]);
  const adapter = new MercadoPagoPaymentAdapter("https://api.mercadopago.com", "fixture", undefined, f.fetcher);
  assert.deepEqual(await adapter.cancelPayment({ ...input, providerPaymentId: "preference_qa" }), { state: "blocked" });
  assert.equal(f.calls.length, 0);
  assert.deepEqual(await adapter.cancelPayment({ ...input, providerPaymentId: "12345" }), { state: "cancelled" });
  assert.equal(f.calls[1].init?.method, "PUT"); assert.deepEqual(JSON.parse(f.calls[1].init!.body as string), { status: "cancelled" });
});
test("Stripe cancels on the same Connect account with a stable idempotency key", async () => {
  const adapter = new StripePaymentAdapter("sk_test_fixture", "pk_test_fixture");
  const calls: unknown[][] = [];
  (adapter as any).stripe = { paymentIntents: { retrieve: async (...args: unknown[]) => { calls.push(args); return { status: "requires_action" }; },
    cancel: async (...args: unknown[]) => { calls.push(args); return { status: "canceled" }; } } };
  assert.deepEqual(await adapter.cancelPayment({ ...input, providerPaymentId: "pi_qa", stripeConnectAccountId: "acct_qa", stripeChargeMode: "direct_v2" }), { state: "cancelled" });
  assert.deepEqual(calls[0][2], { stripeAccount: "acct_qa" });
  assert.deepEqual(calls[1][2], { stripeAccount: "acct_qa", idempotencyKey: "buyer-edit:pi_qa" });
});
