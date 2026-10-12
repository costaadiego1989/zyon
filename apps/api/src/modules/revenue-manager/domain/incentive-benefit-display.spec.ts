import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_MERCHANT_RULES } from "@zyon/shared-types";
import { assessExecutableIncentive } from "./executable-incentive.js";
import { incentiveBenefitDisplay } from "./incentive-benefit-display.js";
import { progressiveIncentiveStages, type StrategyIncentiveRecommendation } from "./strategy-incentive-recommendation.js";

const rules = { ...DEFAULT_MERCHANT_RULES, autonomousEngineEnabled: true, maxDiscountPercent: 40, minimumMarginPercent: 38 };
const recommendation = () => ({ status: "recommended", definition: "weekly-incentive-recommendation-v3", test: {
  kind: "capped_percentage_discount", discountPercent: 40, maxDiscountCents: 1500, minimumMarginPercent: 38,
  audience: { minCartTotalCents: 1, maxCartTotalCents: 100000 }, delivery: { mode: "automatic" },
} } as unknown as StrategyIncentiveRecommendation);
const cart = (total: number) => ({ id: "cart", currency: "BRL", total, items: [{ sku: "p", name: "Produto", price: total, cost: 1, quantity: 1 }] } as any);
test("40 percent with R$15 cap presents the actual granted amount and respects the store percentage ceiling", () => {
  const r = recommendation();
  assert.equal(assessExecutableIncentive(cart(20), rules, r)?.amountCents, 800);
  assert.equal(assessExecutableIncentive(cart(100), rules, r)?.amountCents, 1500);
  assert.equal(assessExecutableIncentive(cart(100), { ...rules, maxDiscountPercent: 10 }, r), null);
  const display = incentiveBenefitDisplay(r, 800);
  assert.match(display.message, /40%/);
  assert.match(display.message, /15,00/);
  assert.match(display.message, /8,00.*aplicados/);
});
test("fixed coupon states money applied without treating the safety percentage as the offer", () => {
  const r: any = recommendation(); r.test.kind = "capped_fixed_discount"; r.test.fixedDiscountCents = 1500;
  r.test.delivery = { mode: "coupon_code", code: "ZYON" + "A".repeat(20) };
  const display = incentiveBenefitDisplay(r, 1500);
  assert.equal(display.title, "Cupom personalizado aplicado");
  assert.match(display.message, /15,00/);
  assert.equal(display.message.includes("%"), false);
});
test("progressive display names only the granted stage and its cap", () => {
  const r: any = recommendation(); r.definition = "weekly-incentive-recommendation-v4";
  r.test.kind = "capped_progressive_discount"; r.test.stages = progressiveIncentiveStages(40, 1500);
  const first = incentiveBenefitDisplay(r, 400, 0);
  assert.match(first.message, /Etapa 1 de 2/);
  assert.match(first.message, /20%/);
  assert.equal(first.message.includes("40%"), false);
  assert.match(incentiveBenefitDisplay(r, 1500, 1).message, /Etapa 2 de 2: 40%/);
  assert.throws(() => incentiveBenefitDisplay(r, 1500, 0), /INVALID_INCENTIVE_DISPLAY/);
});
test("zero, missing progressive stage or an amount above the cap cannot become a displayed benefit", () => {
  const r: any = recommendation();
  for (const value of [0, -1, 1501, 1.5, NaN]) assert.throws(() => incentiveBenefitDisplay(r, value), /INVALID_INCENTIVE_DISPLAY/);
  r.test.kind = "capped_progressive_discount";
  assert.throws(() => incentiveBenefitDisplay(r, 100), /INVALID_INCENTIVE_DISPLAY/);
});
