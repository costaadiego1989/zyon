import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PlanTile } from "./PlanTile.js";
import { PlanCard } from "./PlanCard.js";
import { toPlanDef } from "../plan-catalog.js";
import { BILLING_PLANS } from "@zyon/shared-types";
import { NAV_ITEMS } from "../../../shell/nav-config.js";

describe("approved shared plan presentation", () => {
  const plan = toPlanDef({ key: "scale", name: "Scale", priceBrl: 749, transactionFeeCents: 99, ctaLabel: "Escolher", trialDays: 0, features: Object.entries(BILLING_PLANS.scale.features).filter(([, enabled]) => enabled).map(([key]) => key), limits: BILLING_PLANS.scale.limits });
  it("uses the approved signup plan tile without changing amounts or action authority", () => {
    const html = renderToStaticMarkup(<PlanTile plan={plan} billingCycle="monthly" selected><button>Existing action</button></PlanTile>);
    expect(html).toContain('data-plan-key="scale"');
    expect(html).toContain("signup-plan--selected");
    expect(html).toContain("Existing action");
    expect(html).toContain("749,00");
  });
  it("keeps the current-plan action disabled on the dashboard", () => {
    const html = renderToStaticMarkup(<PlanCard plan={plan} isCurrent isDowngrade={false} onUpgrade={() => { throw Error("must not execute on render"); }} upgrading={false} />);
    expect(html).toContain("signup-plan");
    expect(html).toContain("Seu plano");
    expect(html).toContain("disabled");
  });
  it("does not duplicate operational Marketplace shortcuts in the main navigation", () => {
    const keys = NAV_ITEMS.map(item => item.key);
    expect(keys).not.toContain("marketplace");
    for (const key of ["marketplace-payments", "marketplace-shipments", "marketplace-refunds", "marketplace-asaas-wallet-returns", "marketplace-contributions"]) expect(keys).not.toContain(key);
    for (const key of ["catalog", "overview", "delivery", "agent-config", "billing-plans"]) expect(keys).toContain(key);
  });
});
