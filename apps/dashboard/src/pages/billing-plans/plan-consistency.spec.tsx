import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { BILLING_PLANS, billingOffer } from "@zyon/shared-types";
import type { BillingPlanCard } from "../../api/types.js";
import { toPlanDef, selectedBillingOffer } from "./plan-catalog.js";
import { BillingPlanDetails } from "./components/BillingPlanDetails.js";

function catalogPlan(key: "starter" | "growth" | "scale"): BillingPlanCard {
  const config = BILLING_PLANS[key];
  return { key, name: config.name, priceBrl: config.monthlyPriceBrl,
    transactionFeeCents: config.transactionFeeCents, limits: config.limits,
    trialDays: key === "starter" ? 14 : 0, ctaLabel: "Escolher",
    features: Object.entries(config.features).filter(([, enabled]) => enabled).map(([feature]) => feature),
    billingOptions: [billingOffer(config.monthlyPriceBrl * 100, "monthly"), billingOffer(config.monthlyPriceBrl * 100, "annual", 15)],
    annualCheckoutAvailable: key !== "starter" };
}

describe("consistent plan information", () => {
  it("uses prices, fees and limits returned by the API instead of marketing defaults", () => {
    const plan = toPlanDef({ ...catalogPlan("growth"), priceBrl: 487.35, transactionFeeCents: 157,
      limits: { ordersPerMonth: 640, voiceSessionsPerMonth: 125 }, billingOptions: undefined });
    expect(selectedBillingOffer(plan, "monthly")?.amountCents).toBe(48735);
    const html = renderToStaticMarkup(<BillingPlanDetails plan={plan} billingCycle="monthly" />);
    expect(html).toContain("487,35");
    expect(html).toContain("1,57");
    expect(html).toContain("640");
    expect(html).toContain("125");
    expect(html).not.toContain("500 pedidos");
  });
  it("only lists enabled features, translating them once without repeating benefits", () => {
    const plan = toPlanDef({ ...catalogPlan("growth"), features: ["customTheme", "voiceCheckout", "customTheme", "futureInternalFlag"] });
    expect(plan.features).toEqual(["Tema da loja personalizado", "Checkout por voz"]);
  });
  it("keeps missing limits distinct from zero and unlimited", () => {
    const plan = toPlanDef({ ...catalogPlan("growth"), limits: { ordersPerMonth: null } });
    const html = renderToStaticMarkup(<BillingPlanDetails plan={plan} billingCycle="monthly" />);
    expect(html).toContain("Ilimitado");
    expect(html).toContain("Não informado");
    expect(toPlanDef({ ...catalogPlan("starter"), limits: { ordersPerMonth: 100 } }).limits.voiceSessions).toBeUndefined();
    expect(toPlanDef({ ...catalogPlan("starter"), limits: { ordersPerMonth: 100, voiceSessionsPerMonth: 0 } }).limits.voiceSessions).toBe(0);
  });
  it.each(["growth", "scale"] as const)("shows the exact annual total for %s and no fabricated offer when unavailable", key => {
    const plan = toPlanDef(catalogPlan(key));
    const expected = key === "growth" ? 457980 : 763980;
    expect(selectedBillingOffer(plan, "annual")?.amountCents).toBe(expected);
    const html = renderToStaticMarkup(<BillingPlanDetails plan={plan} billingCycle="annual" />);
    expect(html).toContain(key === "growth" ? "4.579,80" : "7.639,80");
    expect(html).toContain("pago de uma vez");
    expect(selectedBillingOffer({ ...plan, annualCheckoutAvailable: false }, "annual")).toBeUndefined();
  });
});
