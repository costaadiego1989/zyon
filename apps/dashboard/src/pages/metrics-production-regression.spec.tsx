import { describe, expect, it } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { actionBadgeCategory, filterEvents } from "./useAuditLogPage.js";
import { calcTrend } from "./overview/OverviewPage.js";
import { paymentMethodLabel } from "./finance/payment-method-label.js";
import { ExperimentCard } from "./experiments/components/ExperimentCard.js";

describe("production metrics regressions", () => {
  it("suppresses unavailable/zero baseline trends, retaining valid comparisons", () => {
    expect(calcTrend(1, undefined)).toBeUndefined();
    expect(calcTrend(1, null)).toBeUndefined();
    expect(calcTrend(1, 0)).toBeUndefined();
    expect(calcTrend(50, 100)).toBe(-50);
  });
  it("filters legacy HTTP creations and changes without inventing creations for POST commands", () => {
    expect(actionBadgeCategory("http.post", { path: "/v1/dashboard/experiments" })).toBe("constructive");
    expect(actionBadgeCategory("http.post", { path: "/v1/api-keys" })).toBe("constructive");
    expect(actionBadgeCategory("http.put")).toBe("update");
    expect(actionBadgeCategory("http.patch")).toBe("update");
    for (const path of ["/v1/dashboard/experiments/:id/archive", "/v1/checkout/intent", "/v1/shipping/quote", "/v1/api-keys/:id/revoke"]) {
      expect(actionBadgeCategory("http.post", { path })).toBe("other");
    }
    const events = [{ action: "http.post", metadata: { path: "/v1/api-keys" }, actor_type: "human" }, { action: "http.post", metadata: { path: "/v1/cart" }, actor_type: "human" }] as any;
    expect(filterEvents(events, { dateRange: "all", actionCategory: "constructive", actorType: "all" })).toHaveLength(1);
  });
  it("renders actual A/B sessions and revenue in BRL, distinguishing unavailable metrics", () => {
    const experiment = { id: "exp", name: "QA", status: "completed", variants: [], created_at: "2026-10-06", sample_size: 9999 } as any;
    const html = renderToStaticMarkup(<ExperimentCard experiment={experiment} selected={false} onSelect={() => {}} metrics={[{ experiment_id: "exp", variant_id: "control", total_visitors: 553, conversions: 1, conversion_rate: .18, revenue: 29.9 }]} />);
    expect(html).toContain("553");
    expect(html).toContain("29,90");
    expect(html).not.toContain("0,299");
    expect(html).not.toContain("9999");
    const unavailable = renderToStaticMarkup(<ExperimentCard experiment={experiment} selected={false} onSelect={() => {}} />);
    expect(unavailable).toContain("—");
    expect(unavailable).not.toContain("9999");
  });
  it.each([["card", "Cartão"], ["credit_card", "Cartão"], ["pix", "PIX"], ["bank_slip", "Boleto"], [null, "Não informado"], ["", "Não informado"]])("translates %s without changing technical API values", (value, label) => {
    expect(paymentMethodLabel(value)).toBe(label);
  });
});
