import { test, expect } from "vitest";
import { billingEndpoints } from "./billing.js";

test("billing catalog supports the active controller and the public API envelope", async () => {
  const card = { key: "starter", name: "Free", priceBrl: 0, transactionFeeCents: 299, trialDays: 14, recommended: false, ctaLabel: "Continuar no Free", features: ["customTheme"], limits: { ordersPerMonth: 100 } };
  const response = { data: [{ plan_id: "starter", name: "Free", monthly_price_brl: 0, transaction_fee_cents: 299, features: { customTheme: true }, limits: { ordersPerMonth: 100 } }], meta: { version: "v1" } };
  for (const body of [[card], response]) {
    const api = billingEndpoints("https://api.example.test", (async () => new Response(JSON.stringify(body), { headers: { "Content-Type": "application/json" } })) as typeof fetch);
    expect(await api.listBillingPlans()).toEqual([card]);
  }
});
