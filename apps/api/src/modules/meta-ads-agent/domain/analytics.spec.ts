import assert from "node:assert/strict";
import { test } from "node:test";
import type { MetaAdsMetrics } from "@zyon/shared-types";
import type { ProviderMetricSnapshot, PaidOrderFact, MetaAdsRecord } from "./types.js";
import { buildMetrics, assessData, summarizeUsage } from "./analytics.js";
const remote: ProviderMetricSnapshot = { campaignId: "campaign-a", currency: "BRL", since: "2026-11-01", until: "2026-11-14", timezone: "America/Sao_Paulo", attributionWindow: "7d_click+1d_view", spendCents: 2000, attributedRevenueCents: 15000, attributedPurchases: 2, conversations: 15 };
test('AGW-07 Meta delivery counts and purchases remain separate from confirmed Zyon orders',()=>{
 const result=metrics(undefined,{...remote,impressions:1200,reach:900,linkClicks:40});
 assert.equal(result.attributedPurchases,2);assert.equal(result.paidOrders,1);assert.equal(result.costPerPurchaseCents,2000);
 assert.equal(result.impressions,1200);assert.equal(result.reach,900);assert.equal(result.linkClicks,40);
 const missing=metrics();assert.equal(missing.impressions,null);assert.equal(missing.reach,null);assert.equal(missing.linkClicks,null);
});
const order: PaidOrderFact = { orderId: "order-a", sessionId: "session-a", merchantId: "store-a", paid: true, paidAt: "2026-11-10T12:00:00Z", currency: "BRL", paidCents: 10000, refundedCents: 2000, costCents: null, costCoverage: "unavailable" };
const metrics = (orders = [order], snapshot = remote): MetaAdsMetrics => buildMetrics({ campaignId: "campaign-a", remote: snapshot, orders, updatedAt: "2026-11-15T12:00:00Z" });
test("MGA-51 reported metrics identify period, currency, update, source, timezone and attribution window", () => {
  const result = metrics(); assert.equal(result.since, "2026-11-01"); assert.equal(result.until, "2026-11-14"); assert.equal(result.currency, "BRL"); assert.equal(result.updatedAt, "2026-11-15T12:00:00Z"); assert.equal(result.timezone, "America/Sao_Paulo"); assert.equal(result.attributionWindow, "7d_click+1d_view"); assert.equal(result.source, "meta_reported+zyon_reconciled");
});
test("MGA-52 WhatsApp conversations remain separate from canonical paid purchases", () => {
  const result = metrics(); assert.equal(result.conversations, 15); assert.equal(result.paidOrders, 1); assert.equal(result.confirmedRevenueCents, 8000); assert.equal(result.attributedRevenueCents, 15000); assert.equal(result.costPerPurchaseCents, 2000); assert.equal(metrics([], { ...remote, conversations: 999 }).paidOrders, 0); assert.equal(metrics([]).costPerPurchaseCents, null);
});
test("MGA-58 missing historical costs or population components prevent complete contribution", () => {
  assert.equal(metrics().contributionCents, null); assert.equal(metrics().costCoverage, "unavailable");
  const mixed = metrics([{ ...order, costCents: 3000, costCoverage: "complete" }, { ...order, orderId: "order-b" }]); assert.equal(mixed.costCoverage, "partial"); assert.equal(mixed.contributionCents, null);
  const complete = metrics([{ ...order, costCents: 3000, costCoverage: "complete" }]); assert.equal(complete.costCoverage, "complete"); assert.equal(complete.contributionCents, 3000); assert.equal(metrics([]).contributionCents, null);
});
test("MGA-59 observed attribution and ROAS do not claim causal uplift", () => {
  const result = metrics(); assert.equal(result.roas, 7.5); assert.ok(result.notes.includes("observed_attribution_not_causal_uplift")); assert.equal(result.confirmedRevenueCents, 8000); assert.notEqual(result.confirmedRevenueCents, result.attributedRevenueCents);
});
test("MGA-60 mismatched currencies prevent combined ROAS and contribution", () => {
  const result = metrics([{ ...order, currency: "USD" }]); assert.equal(result.confirmedRevenueCents, null); assert.equal(result.roas, null); assert.equal(result.costPerPurchaseCents, null); assert.equal(result.contributionCents, null); assert.ok(result.notes.includes("currency_mismatch"));
  assert.equal(metrics([], { ...remote, spendCents: 0 }).roas, null);
});
test("MGA-63 insufficient or stale data stays awaiting data without declaring a winner", () => {
  assert.deepEqual(assessData("paid_sales", metrics([])), { status: "awaiting_data", missing: ["confirmed_purchases"] });
  assert.ok(assessData("contribution", metrics()).missing.includes("historical_costs")); assert.equal(assessData("roas", { ...metrics(), stale: true }).status, "awaiting_data");
  assert.equal(assessData("roas", metrics()).status, "available"); assert.equal(assessData("cost_per_purchase", { ...metrics(), spendCents: null }).status, "awaiting_data");
});
test("corrective usage supersedes original unknown entries and keeps different currencies separate", () => {
  const row = (key: string, payload: unknown): MetaAdsRecord => ({ key, kind: "usage", payload, createdAt: "2026-11-15T12:00:00Z" });
  const result = summarizeUsage([row("unknown-a", { usage: { costMicros: null, currency: null, costStatus: "unpriced" } }), row("fixed-a", { correctsUsageKey: "unknown-a", usage: { costMicros: "123", currency: "USD", costStatus: "estimated" } }), row("review-a", { usage: { costMicros: "7", currency: "USD", costStatus: "estimated" } }), row("other", { usage: { costMicros: "50", currency: "BRL", costStatus: "provider_reported" } }), row("unknown-b", { usage: { costMicros: null, currency: null, costStatus: "unpriced" } })]);
  assert.deepEqual(result, { costMicrosByCurrency: { USD: "130", BRL: "50" }, unpriced: 1, attempts: 4, estimated: 2, providerReported: 1 });
});
