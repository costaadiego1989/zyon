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

test("invoice history accepts direct and enveloped responses without changing amounts or status", async () => {
  const invoice = { invoice_id: "inv-ui", amount_brl: 749, status: "paid", period_start: "2026-08-01", period_end: "2026-09-01", created_at: "2026-09-01" };
  for (const body of [[invoice], { data: [invoice], meta: { version: "v1" } }, []]) {
    let request: { url: string; method: string | undefined } | undefined;
    const api = billingEndpoints("https://api.example.test", (async (url, init) => {
      request = { url: String(url), method: init?.method ?? "GET" };
      return new Response(JSON.stringify(body), { headers: { "Content-Type": "application/json" } });
    }) as typeof fetch);
    expect(await api.listBillingInvoices()).toEqual(Array.isArray(body) ? body : body.data);
    expect(request).toEqual({ url: "https://api.example.test/v1/billing/invoices", method: "GET" });
  }
});
