import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { StrategyProposal } from "../../api/endpoints/strategy-review.js";
import { StrategyIncentiveRecommendation } from "./StrategyIncentiveRecommendation.js";
import { StrategyDiscountStudy } from "./StrategyDiscountStudy.js";
import { incentiveBenefitLabel, incentiveOfferText, validIncentiveTest } from "./incentive-recommendation-model.js";

type Recommendation = NonNullable<StrategyProposal["incentiveRecommendation"]>;
const recommendation = (): Recommendation => ({
  definition: "weekly-incentive-recommendation-v3", approval: "separate_incentive_review_required", execution: "unavailable",
  budgetStatus: "not_reserved", financialPolicy: { version: 1, policyHash: "a".repeat(64) }, status: "recommended",
  planning: { definition: "incentive-fixed-horizon-planning-v1", durationDays: 7, conversionWindowHours: 168,
    allocation: "50/50", minimumEffectBps: 100, confidence: .95, planningPower: .8,
    baseline: { buyers: 10000, conversions: 10, complete: true, windowStart: "2026-09-01T00:00:00Z", windowEnd: "2026-09-29T00:00:00Z" },
    minimumBuyersPerArm: 936, weeklyBuyersPerArm: 1250, fundedTreatmentBuyers: 1000, requiredBudgetCents: 936000,
    status: "estimated_feasible", result: "not_measured", blockers: [] },
  test: { kind: "capped_percentage_discount", currency: "BRL", discountPercent: 10, maxDiscountCents: 1000,
    limitCents: 1000000, maxRedemptions: 1000, maxPerBuyer: 1, durationDays: 7, start: "after_specific_approval",
    allocation: "50/50", control: "current_checkout_without_test_incentive", stacking: "no_other_coupon_or_incentive",
    minimumMarginPercent: 38, delivery: { mode: "automatic" },
    audience: { intent: "price_sensitive", consent: "required", identity: "first_eligible_session_per_buyer",
      holdout: "excluded", minCartTotalCents: 10000, maxCartTotalCents: 20000 },
    measurement: { result: "not_measured", samplePlanning: "included_in_recommendation", conversionWindowHours: 168 } },
});
const render = (r: Recommendation) => renderToStaticMarkup(<StrategyIncentiveRecommendation recommendation={r} policyCurrent />);

describe("commercial recommendation display boundary", () => {
  it("does not present a product discount replay as evidence of a shipping benefit", () => {
    const study: NonNullable<StrategyProposal["discountStudy"]> = {
      definition: "weekly-discount-study-v2", asOf: "2026-09-29T00:00:00Z", capturedAt: "2026-09-29T00:00:00Z",
      lookbackDays: 28, approvalScope: "communication_only", commercialBudget: "not_reserved", status: "candidate_available",
      candidate: { intent: "price_sensitive", percent: 10, simulation: { sampleSize: 30, observedConversionRate: .1,
        minimumProjectedMarginPercent: 46, minCartTotalCents: 10000, maxCartTotalCents: 20000, maxDiscountCents: 2000,
        replayDiscountTotalCents: 60000, paymentFeeAssumptionPercent: 4, conversionWindowHours: 168 } },
      commercialCandidate: { kind: "capped_shipping_discount", maxDiscountCents: 1000, delivery: "automatic",
        evidence: { basis: "observed_shipping_burden", sampleSize: 30, minShippingCents: 1000, maxShippingCents: 3000, maxShippingCostCents: 2500 } },
    };
    const html = renderToStaticMarkup(<StrategyDiscountStudy study={study} />);
    expect(html).toContain("Fretes observados no histórico");
    expect(html).toMatch(/R\$\s*10,00 a R\$\s*30,00/);
    expect(html).toContain("ainda não há resultado medido desse benefício");
    expect(html).not.toContain("<dt>Menor margem estimada</dt>");
    expect(html).not.toContain("<dt>Desconto simulado</dt>");
    expect(html).toContain("simulação de referência percentual nos produtos");
    study.commercialCandidate!.evidence.minShippingCents = 4000;
    expect(renderToStaticMarkup(<StrategyDiscountStudy study={study} />)).toContain("Atualize o dashboard");
  });

  it("keeps historical percentage recommendations readable without extending their authority", () => {
    for (const definition of ["weekly-incentive-recommendation-v1", "weekly-incentive-recommendation-v2"] as const) {
      const r = recommendation(); r.definition = definition; delete r.test!.delivery;
      r.test!.measurement.samplePlanning = definition.endsWith("v1") ? "required_before_activation" : "included_in_recommendation";
      expect(validIncentiveTest(r)).toBe(true);
      expect(incentiveOfferText(r.test!)).toMatch(/10%, até R\$\s*10,00 por compra/);
      r.test!.delivery = { mode: "coupon_code", code: "ZYON" + "A".repeat(20) };
      expect(validIncentiveTest(r)).toBe(false);
    }
  });

  it.each(["capped_percentage_discount", "capped_fixed_discount", "capped_shipping_discount"] as const)("renders exact terms for %s with automatic and coupon delivery", kind => {
    for (const coupon of [false, true]) {
      const r = recommendation(), t = r.test!; t.kind = kind;
      if (kind === "capped_fixed_discount") t.fixedDiscountCents = 1000;
      if (kind === "capped_shipping_discount") t.shippingDiscountCents = 1000;
      if (coupon) t.delivery = { mode: "coupon_code", code: "ZYON0123456789ABCDEF0123" };
      expect(validIncentiveTest(r)).toBe(true);
      const html = render(r);
      expect(html).toContain("é um desconto real da loja");
      expect(html).toContain("não geram cobrança extra de IA");
      expect(html).toContain("7 dias após aprovação específica");
      expect(incentiveBenefitLabel(t)).toBe(coupon ? "cupom" : kind === "capped_shipping_discount" ? "desconto no frete" : "desconto");
      if (kind === "capped_fixed_discount") expect(html).toMatch(/R\$\s*10,00 de desconto por compra/);
      if (kind === "capped_shipping_discount") {
        expect(html).toMatch(/Até R\$\s*10,00 de desconto no frete/);
        expect(html).toContain("Isso não libera frete grátis para toda a loja");
      }
      if (coupon) {
        expect(html).toContain("ZYON0123456789ABCDEF0123");
        expect(html).toContain("Compartilhar o código não libera o cupom para outros compradores");
        expect(html).toContain("aplicado automaticamente aos compradores elegíveis");
      }
    }
  });

  it.each([
    ["unknown definition", (r: Recommendation) => { r.definition = "future" as never; }],
    ["unknown benefit", (r: Recommendation) => { r.test!.kind = "free_shipping" as never; }],
    ["missing delivery", (r: Recommendation) => { delete r.test!.delivery; }],
    ["public code format", (r: Recommendation) => { r.test!.delivery = { mode: "coupon_code", code: "PUBLICO10" }; }],
    ["automatic with code", (r: Recommendation) => { r.test!.delivery = { mode: "automatic", code: "ZYON" + "A".repeat(20) } as never; }],
    ["missing fixed value", (r: Recommendation) => { r.test!.kind = "capped_fixed_discount"; }],
    ["ambiguous amount", (r: Recommendation) => { r.test!.fixedDiscountCents = 1000; }],
    ["fixed amount above cap", (r: Recommendation) => { r.test!.kind = "capped_fixed_discount"; r.test!.fixedDiscountCents = 1001; }],
    ["shipping amount below displayed cap", (r: Recommendation) => { r.test!.kind = "capped_shipping_discount"; r.test!.shippingDiscountCents = 999; }],
    ["multiple benefit kinds", (r: Recommendation) => { r.test!.kind = "capped_shipping_discount"; r.test!.shippingDiscountCents = 1000; r.test!.fixedDiscountCents = 1000; }],
    ["fractional cents", (r: Recommendation) => { r.test!.maxDiscountCents = 1000.1; }],
    ["inconsistent budget", (r: Recommendation) => { r.test!.limitCents = 1000001; }],
    ["invalid percentage ceiling", (r: Recommendation) => { r.test!.discountPercent = NaN; }],
    ["foreign currency", (r: Recommendation) => { r.test!.currency = "USD" as never; }],
    ["no consent", (r: Recommendation) => { r.test!.audience.consent = "optional" as never; }],
    ["holdout participates", (r: Recommendation) => { r.test!.audience.holdout = "included" as never; }],
  ])("hides financial terms and approval when %s is not understood", (_label, mutate) => {
    const r = recommendation(); mutate(r);
    expect(validIncentiveTest(r)).toBe(false);
    const html = render(r);
    expect(html).toContain("Atualize o dashboard para consultar este formato de sugestão");
    expect(html).not.toContain("Orçamento máximo sugerido");
    expect(html).not.toContain("<button");
  });
});
