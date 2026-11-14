import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { BillingPromotionField } from "./BillingPromotionField.js";
import { billingCheckoutError } from "../billing-checkout-error.js";
import { DashboardHttpError } from "../../../api/http/error.js";

describe("subscription campaign entry", () => {
  it("automatically shows a public campaign without asking for code entry", () => {
    const html = renderToStaticMarkup(<BillingPromotionField value="" onChange={() => {}} cycle="monthly" promotion={{ code: "BLACKFRIDAY", name: "Black Friday", plans: ["growth"], discountType: "percent", discountValue: 5000, duration: "repeating", durationMonths: 3, startsAt: "2026-10-01", expiresAt: "2026-12-01", firstTimeOnly: false }} />);
    expect(html).toContain("aplicada automaticamente"); expect(html).toContain("50% de desconto");
    expect(html).toContain("Você não precisa digitar um código."); expect(html).toContain("Tenho outro cupom");
    expect(html).not.toContain('<details class="billing-promotion-manual" open');
  });
  it("labels the optional field and explains server validation before payment", () => {
    const html = renderToStaticMarkup(<BillingPromotionField value="BLACKFRIDAY" onChange={() => {}} cycle="monthly" />);
    expect(html).toContain("Cupom de assinatura"); expect(html).toContain('value="BLACKFRIDAY"');
    expect(html).toContain("antes de pagar"); expect(html).toContain("aria-describedby="); expect(html).not.toContain("disabled=");
  });
  it("disables entry for annual billing and explains that it is not applied", () => {
    const html = renderToStaticMarkup(<BillingPromotionField value="BLACKFRIDAY" onChange={() => {}} cycle="annual" />);
    expect(html).toContain("disabled="); expect(html).toContain("não se aplicam ao anual");
  });
  it.each(["billing_promotion_invalid", "billing_promotion_monthly_only", "billing_promotion_plan_not_allowed", "billing_promotions_unavailable"])("explains %s without provider details", code => {
    const message = billingCheckoutError(new DashboardHttpError(400, JSON.stringify({ code })), "fallback");
    expect(message).not.toBe("fallback"); expect(message).not.toContain(code);
  });
  it("does not display untrusted provider messages", () => {
    expect(billingCheckoutError(new DashboardHttpError(500, JSON.stringify({ detail: "private_provider_token" })), "fallback")).toBe("fallback");
  });
});
