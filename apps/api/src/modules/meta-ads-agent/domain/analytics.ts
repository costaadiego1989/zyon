import type { MetaAdsMetrics, MetaAdsPriority } from "@zyon/shared-types";
import type { ProviderMetricSnapshot, PaidOrderFact, MetaAdsRecord } from "./types.js";

export function buildMetrics(input: { campaignId: string; remote: ProviderMetricSnapshot; orders: PaidOrderFact[]; updatedAt: string }): MetaAdsMetrics {
  const { remote } = input; const orders = [...new Map(input.orders.filter(order => order.paid).map(order => [order.orderId, order])).values()];
  const matchingCurrency = orders.every(order => order.currency === remote.currency);
  const revenue = matchingCurrency ? orders.reduce((total, order) => total + Math.max(0, order.paidCents - order.refundedCents), 0) : null;
  const costCount = orders.filter(order => order.costCoverage === "complete" && order.costCents !== null).length;
  const coverage = !orders.length || !costCount ? "unavailable" : costCount === orders.length ? "complete" : "partial";
  const spend = remote.spendCents;
  return { campaignId: input.campaignId, since: remote.since, until: remote.until, updatedAt: input.updatedAt, timezone: remote.timezone,
    currency: remote.currency, attributionWindow: remote.attributionWindow, source: "meta_reported+zyon_reconciled", spendCents: spend,
    attributedRevenueCents: remote.attributedRevenueCents, confirmedRevenueCents: revenue, paidOrders: orders.length, conversations: remote.conversations,
    attributedPurchases: remote.attributedPurchases, impressions: remote.impressions??null, reach: remote.reach??null, linkClicks: remote.linkClicks??null,
    costPerPurchaseCents: matchingCurrency && orders.length && spend !== null ? Math.round(spend / orders.length) : null,
    roas: matchingCurrency && spend !== null && spend > 0 && remote.attributedRevenueCents !== null ? remote.attributedRevenueCents / spend : null,
    contributionCents: matchingCurrency && coverage === "complete" && spend !== null && revenue !== null ? revenue - orders.reduce((total, order) => total + order.costCents!, 0) - spend : null,
    costCoverage: coverage, stale: false, notes: ["observed_attribution_not_causal_uplift", "confirmed_orders_require_verified_origin", ...(coverage !== "complete" ? ["historical_costs_incomplete"] : []), ...(!matchingCurrency ? ["currency_mismatch"] : [])] };
}
export function assessData(priority: MetaAdsPriority, metrics: MetaAdsMetrics): { status: "awaiting_data" | "available"; missing: string[] } {
  const missing: string[] = [];
  if (metrics.stale) missing.push("fresh_metrics");
  if (metrics.spendCents === null) missing.push("spend");
  if (!metrics.paidOrders) missing.push("confirmed_purchases");
  if (priority === "roas" && metrics.roas === null) missing.push("attributed_revenue_and_currency");
  if (priority === "cost_per_purchase" && metrics.costPerPurchaseCents === null && metrics.paidOrders) missing.push("cost_per_purchase");
  if (priority === "contribution" && metrics.contributionCents === null) missing.push("historical_costs");
  return { status: missing.length ? "awaiting_data" : "available", missing };
}
/** Corrections replace earlier attempts. Currency totals never imply an exchange rate. */
export function summarizeUsage(records: MetaAdsRecord[]): { costMicrosByCurrency: Record<string, string>; unpriced: number; attempts: number; estimated: number; providerReported: number } {
  type Payload = { correctsUsageKey?: string; usage?: { costMicros?: string | null; currency?: string | null; costStatus?: string } };
  const replaced = new Set(records.map(row => (row.payload as Payload).correctsUsageKey).filter(Boolean));
  const rows = records.filter(row => !replaced.has(row.key)); const totals: Record<string, bigint> = {};
  let unpriced = 0; let estimated = 0; let providerReported = 0;
  for (const row of rows) {
    const usage = (row.payload as Payload).usage;
    if (!usage || !usage.currency || !/^\d+$/.test(usage.costMicros ?? "") || !["estimated", "provider_reported"].includes(usage.costStatus ?? "")) { unpriced++; continue; }
    totals[usage.currency] = (totals[usage.currency] ?? 0n) + BigInt(usage.costMicros!);
    if (usage.costStatus === "estimated") estimated++; else providerReported++;
  }
  return { costMicrosByCurrency: Object.fromEntries(Object.entries(totals).map(([currency, total]) => [currency, String(total)])), unpriced, attempts: rows.length, estimated, providerReported };
}
