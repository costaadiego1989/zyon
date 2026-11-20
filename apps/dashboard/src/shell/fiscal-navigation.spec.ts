import { expect, it } from "vitest";
import { NAV_ITEMS, visibleItemsForPlan } from "./nav-config.js";
import { canAccessTab } from "../lib/auth/permissions.js";
import { fiscalHash, readFiscalNavigation } from "./fiscal-navigation.js";
it("FISCAL-59 fiscal area explicitly authorizes owner and admin only", () => {
  for (const tab of [
    "fiscal-settings",
    "fiscal-invoices",
    "fiscal-detail",
  ] as const) {
    expect(canAccessTab("OWNER", tab)).toBe(true);
    expect(canAccessTab("ADMIN", tab)).toBe(true);
    expect(canAccessTab("STAFF", tab)).toBe(false);
    expect(canAccessTab(undefined, tab)).toBe(false);
  }
});
it("FISCAL-01 own issuer setup is reachable without an unrelated ERP plan", () => {
  expect(
    visibleItemsForPlan(NAV_ITEMS, "API").some(
      (i) => i.key === "fiscal-settings"
    )
  ).toBe(true);
  expect(NAV_ITEMS.find((i) => i.key === "fiscal-settings")?.section).toBe(
    "integrations"
  );
  expect(NAV_ITEMS.find((i) => i.key === "fiscal-invoices")?.section).toBe(
    "sales"
  );
});
it("FISCAL-58 direct hash retains exact intent and environment", () => {
  const h = fiscalHash("fiscal-detail", "production", "original/id? a");
  expect(readFiscalNavigation(h)).toEqual({
    environment: "production",
    intentId: "original/id? a",
  });
  expect(h).not.toContain("Bearer");
});
it("FISCAL-59 absent hash query uses explicit homologation navigation", () =>
  expect(readFiscalNavigation("#fiscal-invoices")).toEqual({
    environment: "homologation",
    intentId: null,
  }));
