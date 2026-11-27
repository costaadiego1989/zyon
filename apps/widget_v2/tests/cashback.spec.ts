import test from "node:test";
import assert from "node:assert/strict";
import { parseCashbackQuote, requestCashback } from "../src/api/cashback.js";
import { CheckoutSession, cartFromExperience } from "../src/api/checkout-session.js";
import { checkoutTotalWithServiceFee } from "../src/lib/checkout-totals.js";

const quote = { merchantId: "merchant", sessionId: "session", programActive: true, eligible: true, reason: null,
  availableCents: 3000, maximumRedeemCents: 2000, reservedCents: 0, estimatedEarnCents: 500,
  ruleVersion: 2, fingerprint: "server-fingerprint", terms: "Crédito para esta loja." };
const api = () => ({ currentMerchantId: "merchant", currentSessionId: "session", authToken: "signed-embed", apiBaseUrl: "https://checkout.example", isPaymentObservation: false }) as unknown as CheckoutSession;

test("CB-13 widget sends session-only reservation with a stable command and signed embed header", async () => {
  const original = globalThis.fetch;
  const client = api();
  const calls: Array<{ body: unknown; authorization: string | null; url: string }> = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), body: JSON.parse(String(init?.body)), authorization: new Headers(init?.headers).get("Authorization") });
    return Response.json({ ...quote, reservedCents: 1000 });
  };
  try {
    const result = await requestCashback(client, "reserve", { amountCents: 1000, idempotencyKey: "command-1" });
    assert.deepEqual(calls, [{ url: "https://checkout.example/embed/cashback/reserve", body: { session_id: "session", amount_cents: 1000, idempotency_key: "command-1" }, authorization: "Bearer signed-embed" }]);
    assert.equal(result.reservedCents, 1000);
    await requestCashback(client, "remove", { idempotencyKey: "remove-1" });
    assert.deepEqual(calls[1]!.body, { session_id: "session", idempotency_key: "remove-1" });
  } finally { globalThis.fetch = original; }
});

test("CB-07 widget refuses a quote for another buyer checkout or merchant", () => {
  assert.throws(() => parseCashbackQuote({ ...quote, merchantId: "other" }, "merchant", "session"), /scope_mismatch/);
  assert.throws(() => parseCashbackQuote({ ...quote, sessionId: "other" }, "merchant", "session"), /scope_mismatch/);
  assert.deepEqual(parseCashbackQuote(quote, "merchant", "session"), quote);
});

test("CB-13 malformed monetary quotes do not become displayed cash credit", () => {
  for (const field of ["availableCents", "maximumRedeemCents", "reservedCents", "estimatedEarnCents"]) {
    for (const value of [-1, 0.5, NaN, Infinity, "1000", Number.MAX_SAFE_INTEGER + 1]) {
      assert.throws(() => parseCashbackQuote({ ...quote, [field]: value }, "merchant", "session"), /invalid/);
    }
  }
  assert.throws(() => parseCashbackQuote({ ...quote, eligible: "true" }, "merchant", "session"), /invalid/);
});

test("CB-14 observation-only sessions cannot reserve or remove cashback", async () => {
  const client = { ...api(), isPaymentObservation: true } as unknown as CheckoutSession;
  await assert.rejects(requestCashback(client, "reserve", { amountCents: 1000, idempotencyKey: "x" }), /observation_only/);
  await assert.rejects(requestCashback(client, "remove", { idempotencyKey: "x" }), /observation_only/);
});

test("CB-15 late responses cannot apply cashback after the session changes", async () => {
  const original = globalThis.fetch;
  const client = api();
  globalThis.fetch = async () => {
    Object.defineProperty(client, "currentSessionId", { value: "another-session" });
    return Response.json(quote);
  };
  try { await assert.rejects(requestCashback(client, "quote"), /checkout_changed/); }
  finally { globalThis.fetch = original; }
});

test("CB-17 totals preserve existing fees and subtract cashback once in integer cents", () => {
  assert.equal(checkoutTotalWithServiceFee({ subtotal: 100, shipping: 15, discount: 0, serviceFee: 0.99 }), 115.99);
  assert.equal(checkoutTotalWithServiceFee({ subtotal: 100, shipping: 15, discount: 0, serviceFee: 0.99, cashbackCents: 2000 }), 95.99);
  assert.equal(checkoutTotalWithServiceFee({ subtotal: 100, shipping: 15, discount: 10, serviceFee: 0.99, cashbackCents: 1000 }), 95.99);
  const experience = cartFromExperience({ items: [], totals: { subtotal: 100, shipping: 15, discount: 0, service_fee: .99, cashback_cents: 2000, total: 95, total_to_pay: 95.99 } });
  assert.equal(experience.total, 100);
  assert.equal(experience.cashbackCents, 2000);
  assert.equal(experience.totalToPay, 95.99);
});

test("CB-17 existing experiences keep the same shape when cashback is absent", () => {
  const result = cartFromExperience({ items: [], totals: { subtotal: 100, discount: 0, total: 100 } });
  assert.equal(Object.hasOwn(result, "cashbackCents"), false);
  assert.equal(result.total, 100);
});

test("stacking transport preserves legacy cart shape when the commercial version is absent", () => {
  const result = cartFromExperience({ items: [], totals: { subtotal: 100, discount: 5, total: 95 } });
  // Preserve the deployed f1037635 transport's existing notices, benefits and shipping fields.
  assert.deepEqual(result, { items: [], total: 100, discount: 5, serviceFee: 0, totalToPay: undefined,
    commercialNotices: [], benefits: undefined, shipping: undefined });
  assert.equal(Object.hasOwn(result, "commercialBenefitsVersion"), false);
});

test("stacking transport preserves commercial version 1 and version 2 despite equal monetary totals", () => {
  const experience = { items: [], totals: { subtotal: 100, discount: 5, total: 95 } };
  const coupon = cartFromExperience({ ...experience, commercial_benefits_version: 1 });
  const rule = cartFromExperience({ ...experience, commercial_benefits_version: 2 });
  assert.equal(coupon.commercialBenefitsVersion, 1);
  assert.equal(rule.commercialBenefitsVersion, 2);
  assert.equal(coupon.discount, 5); assert.equal(rule.discount, 5);
  assert.equal(coupon.total, rule.total);
});

test("stacking transport rejects invalid commercial revisions instead of authorizing a fabricated revision", () => {
  for (const version of [-1, .5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => cartFromExperience({ items: [], totals: { subtotal: 100, discount: 5, total: 95 }, commercial_benefits_version: version }), /checkout_commercial_benefits_version_invalid/);
  }
});

test("stacking start and chat transport carry source revision changes without changing discount totals", async () => {
  const original = globalThis.fetch;
  const client = new CheckoutSession({ embedToken: "signed-embed", merchantId: "merchant", apiBaseUrl: "https://checkout.example" });
  globalThis.fetch = async url => {
    if (String(url).endsWith("/embed/start")) return Response.json({ session_id: "session", experience: {
      items: [], totals: { subtotal: 100, discount: 5, total: 95 }, commercial_benefits_version: 1,
    } });
    if (String(url).endsWith("/embed/chat")) return Response.json({ message: "Regra aplicada", experience: { commercial_benefits_version: 2 } });
    throw new Error("unexpected_endpoint");
  };
  try {
    await client.start();
    assert.equal((await client.fetchCart()).commercialBenefitsVersion, 1);
    await client.chat("Usar a regra da loja");
    const result = await client.fetchCart();
    assert.equal(result.commercialBenefitsVersion, 2);
    assert.equal(result.total, 100); assert.equal(result.discount, 5);
  } finally { globalThis.fetch = original; }
});
