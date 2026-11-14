import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SubscriptionAccessGate } from "./SubscriptionAccessGate.js";

describe("subscription module access state", () => {
  it("keeps active accounts on the selected module", () => {
    const html = renderToStaticMarkup(<SubscriptionAccessGate required={false} role="OWNER" tab="catalog" onViewPlans={() => {}}><div>catalog loaded</div></SubscriptionAccessGate>);
    expect(html).toContain("catalog loaded");
  });
  it("does not mount an expired module or perform its effects", () => {
    let mounts = 0;
    function OperationalPage() { mounts++; return <div>must not mount</div>; }
    const html = renderToStaticMarkup(<SubscriptionAccessGate required role="OWNER" tab="catalog" onViewPlans={() => {}}><OperationalPage /></SubscriptionAccessGate>);
    expect(mounts).toBe(0);
    expect(html).toContain("Assinatura necessária");
    expect(html).toContain("Ver planos");
  });
  it("does not give staff owner billing actions", () => {
    const html = renderToStaticMarkup(<SubscriptionAccessGate required role="STAFF" tab="catalog" onViewPlans={() => {}}><div>restricted</div></SubscriptionAccessGate>);
    expect(html).not.toContain("restricted");
    expect(html).not.toContain("Ver planos");
    expect(html).toContain("proprietário");
  });
  it("keeps existing owner billing/history and financial recovery reachable", () => {
    for (const tab of ["billing-plans", "billing", "account-settings", "marketplace-refunds"] as const) {
      const html = renderToStaticMarkup(<SubscriptionAccessGate required role="OWNER" tab={tab} onViewPlans={() => {}}><div>existing records</div></SubscriptionAccessGate>);
      expect(html).toContain("existing records");
    }
  });
});
