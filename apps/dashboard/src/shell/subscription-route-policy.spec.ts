import { describe, expect, it } from "vitest";
import { NAV_ITEMS, type TabKey } from "./nav-config.js";
import { canAccessTab } from "../lib/auth/permissions.js";
import { isSubscriptionRouteAllowed, resolveSubscriptionTab, SUBSCRIPTION_RECOVERY_TABS } from "./subscription-route-policy.js";

describe("confirmed expired subscription route policy", () => {
  it("keeps an active Free trial and paid accounts on their requested route", () => {
    for (const item of NAV_ITEMS) {
      expect(resolveSubscriptionTab(item.key, false, "OWNER")).toBe(item.key);
      expect(isSubscriptionRouteAllowed(item.key, false, "OWNER")).toBe(true);
    }
  });
  it.each(["catalog", "product-detail", "onboarding", "overview", "payment-connections", "delivery", "agent-config", "marketplace", "unknown"])("expired owner cannot mount %s through a deep link", route => {
    expect(isSubscriptionRouteAllowed(route as TabKey, true, "OWNER")).toBe(false);
    expect(resolveSubscriptionTab(route as TabKey, true, "OWNER")).toBe("billing-plans");
  });
  it("preserves all seven financial remediation routes without opening commercial pages", () => {
    expect(SUBSCRIPTION_RECOVERY_TABS).toHaveLength(7);
    for (const route of SUBSCRIPTION_RECOVERY_TABS) expect(resolveSubscriptionTab(route, true, "OWNER")).toBe(route);
  });
  it("keeps billing history, plans and account accessible to the owner", () => {
    for (const route of ["billing-plans", "billing", "account-settings"] as const) expect(resolveSubscriptionTab(route, true, "OWNER")).toBe(route);
  });
  it.each(["ADMIN", "STAFF"] as const)("does not give %s owner billing privileges", role => {
    expect(resolveSubscriptionTab("billing-plans", true, role)).toBe("account-settings");
    expect(resolveSubscriptionTab("catalog", true, role)).toBe("account-settings");
    for (const item of NAV_ITEMS) if (isSubscriptionRouteAllowed(item.key, true, role)) expect(canAccessTab(role, item.key)).toBe(true);
  });
  it("does not infer owner billing permission from an absent role", () => {
    expect(resolveSubscriptionTab("billing-plans", true, undefined)).toBe("account-settings");
    expect(resolveSubscriptionTab("catalog", true, undefined)).toBe("account-settings");
  });
});
