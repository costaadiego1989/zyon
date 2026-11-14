// Local visual fixture only. Not an authentication, persistence or Stripe test.
import React from "react";
import { createRoot } from "react-dom/client";
import { BILLING_PLANS } from "@zyon/shared-types";
import { ApiContext, type DashboardApi } from "../src/hooks/useApi.js";
import { PlanSelection } from "../src/pages/onboarding-wizard/steps/PlanSelection.js";
import { BillingPlansPage } from "../src/pages/billing-plans/BillingPlansPage.js";
import "../src/styles.css";

const plans = Object.entries(BILLING_PLANS).filter(([key]) => ["starter", "starter179", "growth", "scale"].includes(key)).map(([key, plan]) => ({
  key, name: key === "starter" ? "Free" : key === "starter179" ? "Starter" : key === "growth" ? "Growth" : "Scale",
  priceBrl: plan.monthlyPriceBrl, transactionFeeCents: plan.transactionFeeCents,
  limits: plan.limits, features: Object.entries(plan.features).filter(([, value]) => value).map(([key]) => key),
  trialDays: key === "starter" ? 7 : 0, recommended: key === "growth", ctaLabel: "Escolher plano", annualCheckoutAvailable: false,
}));
const api = {
  listBillingPlans: async () => plans,
  listAutomaticBillingPromotions: async () => [{ code: "BLACKFRIDAY", name: "Black Friday", plans: new URLSearchParams(location.search).has("specific") ? ["growth", "scale"] : ["starter179", "growth", "scale"], discountType: "percent", discountValue: 5000, duration: "repeating", durationMonths: 3, startsAt: "2026-10-01T03:00:00Z", expiresAt: "2026-12-01T03:00:00Z", firstTimeOnly: false }],
  createBillingCheckoutSession: async (payload: unknown) => {
    (window as unknown as { lastPreviewCheckout: unknown }).lastPreviewCheckout = payload;
    throw new Error("local_preview_no_provider_request");
  },
  getBillingSubscription: async () => ({ plan: "starter", plan_name: "Free", status: "trialing", monthly_price_brl: 0, transaction_fee_cents: 199,
    has_subscription: false, has_billing_customer: false, current_period_end: null, cancel_at_period_end: false,
    trial_end: new Date(Date.now() + 7 * 86400000).toISOString(), usage: { orders_current: 0, orders_limit: 100 } }),
} as unknown as DashboardApi;
const dashboard = new URLSearchParams(location.search).has("dashboard");
createRoot(document.getElementById("root")!).render(<ApiContext.Provider value={api}>
  <main className={dashboard ? "" : "signup-plans"} style={dashboard ? { maxWidth: 1280, margin: "0 auto", padding: "24px" } : undefined}>
    {dashboard ? <BillingPlansPage /> : <PlanSelection merchantName="Minha loja" initialPlan="starter179" onDone={() => {}} />}
  </main>
</ApiContext.Provider>);
