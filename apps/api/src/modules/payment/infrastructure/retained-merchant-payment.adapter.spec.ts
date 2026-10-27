import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { RetainedMerchantPaymentAdapter } from "./retained-merchant-payment.adapter.js";

function fixture() {
  const key = "sk_test_retention_owned";
  const input: any = { provider: "stripe", providerAccountFingerprint: createHash("sha256").update(key).digest("hex"), merchantId: "mrc_owned",
    sessionId: "checkout_owned", intentId: "intent_owned", amountCents: 599, currency: "BRL", method: "card", platformFeeCents: 198,
    settlementMode: "delayed_merchant_payout", merchantPayoutDestination: "acct_owned", merchantPayoutHoldDays: 7, merchantPayoutAnchor: "fulfillment" };
  const state = { available: false, refunded: false, wrongScope: false, wrongReceipt: false, posts: 0, methods: [] as string[] };
  const payment = () => ({ id: "pi_owned", object: "payment_intent", status: "succeeded", amount: 599, amount_received: 599, currency: "brl", livemode: false,
    latest_charge: "ch_owned", payment_method_types: ["card"], metadata: { intent_id: state.wrongScope ? "intent_foreign" : "intent_owned", merchant_id: "mrc_owned", session_id: "checkout_owned" } });
  const request: typeof fetch = async (url, init) => {
    const path = new URL(String(url)).pathname; const method = init?.method ?? "GET"; state.methods.push(method);
    let body: any;
    if (path === "/v1/account") body = { id: "acct_platform", country: "BR", charges_enabled: true, payouts_enabled: true };
    else if (path === "/v1/accounts/acct_owned") body = { id: "acct_owned", country: "BR", payouts_enabled: true, capabilities: { transfers: "active" } };
    else if (path === "/v1/payment_intents/pi_owned") body = payment();
    else if (path === "/v1/charges/ch_owned") body = { id: "ch_owned", payment_intent: "pi_owned", paid: true, captured: true, disputed: false,
      refunded: state.refunded, amount_refunded: state.refunded ? 599 : 0, amount: 599, amount_captured: 599, currency: "brl", livemode: false, balance_transaction: "txn_owned" };
    else if (path === "/v1/balance_transactions/txn_owned") body = { id: "txn_owned", source: "ch_owned", amount: 599, fee: 61, net: 538, currency: "brl",
      type: "charge", status: state.available ? "available" : "pending", available_on: 1794513600 };
    else if (path === "/v1/transfers" && method === "POST") {
      state.posts++; const data = new URLSearchParams(String(init?.body));
      assert.equal(data.get("amount"), "340"); assert.equal(data.get("source_transaction"), "ch_owned"); assert.equal(data.get("destination"), "acct_owned");
      assert.equal(new Headers(init?.headers).get("Idempotency-Key"), "zyon:payment-hold:owned");
      body = { id: "tr_owned" };
    } else if (path === "/v1/transfers/tr_owned") body = { id: "tr_owned", destination: state.wrongReceipt ? "acct_foreign" : "acct_owned", amount: 340,
      currency: "brl", source_transaction: "ch_owned", reversed: false, amount_reversed: 0,
      metadata: { marketplace_reference: "zyon:payment-hold:owned", payment_intent_id: "pi_owned" } };
    else throw new Error(`unexpected_provider_path:${path}`);
    return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  };
  const adapter = new RetainedMerchantPaymentAdapter({ stripeSecret: key, asaasOrigin: "https://api-sandbox.asaas.com" }, request);
  return { adapter, input, state };
}

test("read-only preflight and capture prove the platform, recipient, original checkout and exact provider fee", async () => {
  const f = fixture(); await f.adapter.preflight(f.input);
  const capture = await f.adapter.readCapture(f.input, "pi_owned");
  assert.equal(capture.providerFeeCents, 61); assert.equal(capture.netAmountCents, 538); assert.equal(capture.fundsAvailable, false);
  assert.equal(f.state.methods.every(method => method === "GET"), true); assert.equal(f.state.posts, 0);
  f.state.wrongScope = true;
  await assert.rejects(f.adapter.readCapture(f.input, "pi_owned"), /scope_mismatch/);
});

test("a source-backed transfer reservation remains pending until Stripe confirms available funds", async () => {
  const f = fixture(), capture = await f.adapter.readCapture(f.input, "pi_owned");
  const request: any = { provider: "stripe", accountFingerprint: capture.accountFingerprint, providerPaymentId: "pi_owned", destination: "acct_owned",
    amountCents: 340, currency: "BRL", reference: "zyon:payment-hold:owned", capture };
  assert.equal((await f.adapter.submit(request)).state, "pending"); assert.equal(f.state.posts, 1);
  assert.equal((await f.adapter.reconcile(request, "tr_owned")).state, "pending");
  f.state.available = true;
  assert.equal((await f.adapter.reconcile(request, "tr_owned")).state, "confirmed"); assert.equal(f.state.posts, 1);
  f.state.wrongReceipt = true;
  await assert.rejects(f.adapter.reconcile(request, "tr_owned"), /receipt_mismatch/);
});

test("refunds and account changes block retained capture and prevent a transfer POST", async () => {
  const f = fixture(); f.state.refunded = true;
  await assert.rejects(f.adapter.readCapture(f.input, "pi_owned"), /capture_not_available/);
  f.input.providerAccountFingerprint = "foreign-platform";
  await assert.rejects(f.adapter.preflight(f.input), /account_mismatch/); assert.equal(f.state.posts, 0);
});
