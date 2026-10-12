import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_MERCHANT_RULES } from "@zyon/shared-types";
import { assertDiscountStudy, discountStudy, type StrategyDiscountStudy } from "./strategy-discount-study.js";

const rules = { ...DEFAULT_MERCHANT_RULES, autonomousEngineEnabled: true, maxDiscountPercent: 20, minimumMarginPercent: 35 };
const build = (cohorts = [{ intent: "price_sensitive", sampleSize: 30, conversionRate: .1,
  carts: Array.from({ length: 30 }, () => ({ total: 100, currency: "BRL",
    items: [{ sku: "private-variant", name: "Produto", price: 100, cost: 40, quantity: 1 }] })) }]) => discountStudy({
  merchantId: "store", runId: "run", observationId: "obs", asOf: "2026-09-29T00:00:00.000Z",
  capturedAt: "2026-09-29T01:00:00.000Z", rules, cohorts,
});
const check = (value: StrategyDiscountStudy) => assertDiscountStudy(value, "store", "run", "obs", rules);

test("weekly discount study carries aggregate economics without buyer data or an executable rule", () => {
  const study = build();
  assert.equal(study.status, "candidate_available");
  assert.equal(study.candidate?.percent, 20);
  assert.equal(study.candidate?.simulation.replayDiscountTotalCents, 60000);
  assert.equal(study.approvalScope, "communication_only");
  assert.equal(study.commercialBudget, "not_reserved");
  assert.equal(JSON.stringify(study).includes("private-variant"), false);
  assert.equal(JSON.stringify(study).includes("offer_discount"), false);
  check(study);
});

test("weekly discount study records insufficient data as an outcome, never as zero projected gain", () => {
  const study = build([]);
  assert.equal(study.status, "no_safe_candidate");
  assert.equal("candidate" in study, false);
  check(study);
});

for (const [label, change] of [
  ["foreign merchant", (s: any) => s.merchantId = "foreign"],
  ["foreign cycle", (s: any) => s.runId = "foreign"],
  ["foreign evidence", (s: any) => s.observationId = "foreign"],
  ["modified policy", (s: any) => s.policyHash = "f".repeat(64)],
  ["commercial approval scope", (s: any) => s.approvalScope = "discount"],
  ["pretend reservation", (s: any) => s.commercialBudget = "reserved"],
  ["unmature window", (s: any) => s.candidate.simulation.conversionWindowHours = 24],
  ["unsupported lift", (s: any) => s.candidate.simulation.expectedLiftStatus = "measured"],
  ["lower margin", (s: any) => s.candidate.simulation.minimumProjectedMarginPercent = 34],
  ["higher discount", (s: any) => s.candidate.percent = 21],
  ["invented fixed cap", (s: any) => s.candidate.simulation.maxDiscountCents++],
  ["inflated replay total", (s: any) => s.candidate.simulation.replayDiscountTotalCents++],
  ["small sample", (s: any) => s.candidate.simulation.sampleSize = 29],
  ["raw buyers", (s: any) => s.candidate.buyers = ["buyer"]],
  ["extra executable rule", (s: any) => s.rule = { enabled: true }],
  ["capture before cycle", (s: any) => s.capturedAt = "2026-09-28T00:00:00.000Z"],
] as const) test(`weekly discount study rejects ${label}`, () => {
  const study = build(); change(study);
  assert.throws(() => check(study), /STRATEGY_INVALID_DISCOUNT_STUDY/);
});
