import test from "node:test";
import assert from "node:assert/strict";
import { useCheckoutStore } from "../src/store/checkout-store.js";
import { requestCashback } from "../src/api/cashback.js";

test("CR-03 a new server chat snapshot removes previous cashback and revision when both are omitted", async () => {
  const before = useCheckoutStore.getState();
  const api = { chat: async () => ({ message: "Condições atualizadas", stage: "data_collection", blocks: [],
    experience: { stage: "data_collection", items: [{ sku: "p", name: "Produto QA", quantity: 1, unit_price: 100 }],
      totals: { subtotal: 100, discount: 15, total: 85, service_fee: .99, total_to_pay: 85.99 } } }) };
  useCheckoutStore.setState({ api: api as any, status: "active", messages: [], isTyping: false,
    cart: { ...before.cart, items: [{ sku: "p", name: "Produto QA", quantity: 1, price: 100 }],
      total: 100, discount: 15, cashbackCents: 1500, commercialBenefitsVersion: 5, serviceFee: .99, totalToPay: 70.99 } });
  try {
    await useCheckoutStore.getState().sendMessage("Atualizar condições");
    const after = useCheckoutStore.getState();
    assert.equal(after.messages.at(-1)?.text, "Condições atualizadas");
    assert.equal(after.cart.cashbackCents, undefined);
    assert.equal(after.cart.commercialBenefitsVersion, undefined);
    assert.equal(after.cart.discount, 15);
    assert.equal(after.cart.totalToPay, 85.99);
    assert.equal(after.isTyping, false);
  } finally { useCheckoutStore.setState(before); }
});

test("CR-03 cashback uses the canonical embed proxy when its API base differs", async () => {
  const original = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = async input => {
    calls.push(String(input));
    return Response.json({ merchantId: "qa-store", sessionId: "qa-session", programActive: true, eligible: true,
      reason: null, availableCents: 3000, maximumRedeemCents: 1500, reservedCents: 1500,
      estimatedEarnCents: 350, ruleVersion: 1, fingerprint: "server-only", terms: "Condições QA." });
  };
  try {
    const result = await requestCashback({ currentSessionId: "qa-session", currentMerchantId: "qa-store", authToken: "signed-qa",
      apiBaseUrl: "/api/v1", embedApiBaseUrl: "/api" } as any, "quote");
    assert.deepEqual(calls, ["/api/embed/cashback/quote"]);
    assert.equal(result.reservedCents, 1500);
    assert.equal(result.estimatedEarnCents, 350);
  } finally { globalThis.fetch = original; }
});
