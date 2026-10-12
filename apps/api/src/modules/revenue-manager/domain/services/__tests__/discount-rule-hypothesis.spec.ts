import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_MERCHANT_RULES, type Cart } from "@zyon/shared-types";
import { evaluateDiscountOffer } from "@zyon/rules-engine";
import { DiscountRuleHypothesisService, type CohortStats } from "../discount-rule-hypothesis.service.js";

const rules = { ...DEFAULT_MERCHANT_RULES, autonomousEngineEnabled: true, maxDiscountPercent: 20, minimumMarginPercent: 35 };
const cart = (cost = 40, total = 100): Cart => ({ total, currency: "BRL", items: [{ sku: "a", name: "Produto", price: total, cost, quantity: 1 }] });
const cohort = (carts = Array.from({ length: 30 }, () => cart())): CohortStats => ({ intent: "price_sensitive", sampleSize: carts.length, conversionRate: .05, carts });
const service = new DiscountRuleHypothesisService();

test("discount simulation derives a cent-exact cap from observed carts, without inventing uplift", () => {
  const result = service.generate([cohort()], rules)!;
  assert.equal(result.rule.enabled, false);
  assert.deepEqual(result.rule.action.params, { percent: 20, maxDiscountReais: 20 });
  assert.equal(result.simulation.replayDiscountTotalCents, 60_000);
  assert.equal(result.simulation.minimumProjectedMarginPercent, 46);
  assert.equal(result.simulation.expectedLiftStatus, "not_estimated");
  assert.equal("projectedLiftPercent" in result, false);
  assert.match(result.rationale, /precisa ser medido/);
});

test("discount simulation lowers the percentage to protect the least profitable basket", () => {
  const stats = cohort([...Array.from({ length: 29 }, () => cart(10)), cart(60)]);
  const result = service.generate([stats], rules)!;
  const percent = Number(result.rule.action.params.percent);
  assert.ok(percent > 0 && percent < 2);
  assert.ok(result.simulation.minimumProjectedMarginPercent >= 35);
  for (const basket of stats.carts) assert.ok(evaluateDiscountOffer(basket, rules, percent, Number(result.rule.action.params.maxDiscountReais)).approved);
  assert.equal(evaluateDiscountOffer(cart(60), rules, percent + .01).approved, false);
});

test("discount simulation uses a common safe percentage across different cart values", () => {
  const result = service.generate([cohort(Array.from({ length: 30 }, (_, i) => cart(10, i % 2 ? 50 : 100)))], rules)!;
  assert.equal(result.simulation.minCartTotalCents, 5000);
  assert.equal(result.simulation.maxCartTotalCents, 10000);
  assert.equal(result.simulation.replayDiscountTotalCents, 45000);
  assert.deepEqual(result.rule.conditions.slice(1), [
    { field: "cart_total", operator: "gte", value: 50 }, { field: "cart_total", operator: "lte", value: 100 },
    { field: "coupon_applied", operator: "is", value: false }]);
});

for (const [label, mutate] of [
  ["unknown cost", (c: Cart) => { delete c.items[0].cost; }],
  ["null cost", (c: Cart) => { c.items[0].cost = null as never; }],
  ["negative cost", (c: Cart) => { c.items[0].cost = -1; }],
  ["cost above margin floor", (c: Cart) => { c.items[0].cost = 62; }],
  ["no remaining margin", (c: Cart) => { c.items[0].cost = 61; }],
  ["currency", (c: Cart) => { c.currency = "USD"; }],
  ["stacking", (c: Cart) => { c.currentDiscount = 1; }],
  ["invalid precision", (c: Cart) => { c.items[0].cost = .001; }],
  ["invalid quantity", (c: Cart) => { c.items[0].quantity = .5; }],
  ["inconsistent total", (c: Cart) => { c.total = 101; }],
  ["options", (c: Cart) => { c.items[0].selected_options = [{}] as never; }],
] as const) test(`discount simulation rejects ${label} even when the cohort average looks profitable`, () => {
  const stats = cohort(); mutate(stats.carts[29]);
  assert.equal(service.generate([stats], rules), null);
});

test("discount simulation rejects immature-sized or malformed aggregate inputs", () => {
  for (const patch of [{ sampleSize: 29 }, { sampleSize: NaN }, { conversionRate: NaN }, { conversionRate: -.1 },
    { conversionRate: .15 }, { carts: undefined }, { intent: "" }]) {
    assert.equal(service.generate([{ ...cohort(), ...patch } as CohortStats], rules), null);
  }
  for (const minimum of [0, 29, NaN, 30.1]) assert.equal(service.generate([cohort()], rules, minimum), null);
});

test("discount simulation rejects invalid policy and the engine kill switch", () => {
  for (const patch of [{ autonomousEngineEnabled: false }, { maxDiscountPercent: 0 }, { maxDiscountPercent: NaN },
    { maxDiscountPercent: 100.01 }, { maxDiscountPercent: .001 }, { minimumMarginPercent: NaN }, { minimumMarginPercent: -1 }]) {
    assert.equal(service.generate([cohort()], { ...rules, ...patch }), null);
  }
});

test("discount drafts deduplicate only the explicit cycle and never suppress another store", () => {
  const first = service.generate([cohort()], rules)!;
  assert.equal(service.generate([cohort()], rules, 30, new Set([first.fingerprint])), null);
  assert.deepEqual(service.generate([cohort()], rules), first);
  assert.deepEqual(new DiscountRuleHypothesisService().generate([cohort()], rules), first);
});

test("discount simulation supports fractional merchant caps and rounds down every cent", () => {
  const result = service.generate([cohort()], { ...rules, maxDiscountPercent: .25 })!;
  assert.deepEqual(result.rule.action.params, { percent: .25, maxDiscountReais: .25 });
  assert.equal(result.simulation.replayDiscountTotalCents, 750);
});

test("discount simulation skips unsafe cohorts and cannot turn a sub-cent offer into one cent", () => {
  const tiny = cohort(Array.from({ length: 30 }, () => cart(0, .01)));
  assert.equal(service.generate([tiny], rules), null);
  const unsafe = cohort(Array.from({ length: 30 }, () => cart(70))); unsafe.conversionRate = .01;
  assert.ok(service.generate([unsafe, cohort()], rules));
});
