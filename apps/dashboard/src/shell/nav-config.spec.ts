import { expect, test } from "vitest";
import { NAV_ITEMS, visibleItemsForPlan } from "./nav-config.js";
import { canAccessTab, filterNavByRole } from "../lib/auth/permissions.js";
test("Ads with AI has its own store navigation and owner/admin permission without unlocking Revenue Manager", () => {
  const item = NAV_ITEMS.find(i => i.key === "meta-ads-agent");
  expect(item).toMatchObject({key: "meta-ads-agent", label: "Anúncios com IA", section: "intelligence"});
  for (const plan of ["STORE_ONLY", "BOTH", "CHECKOUT_ONLY"] as const) expect(visibleItemsForPlan(NAV_ITEMS, plan).map(i => i.key)).toContain("meta-ads-agent");
  for (const role of ["OWNER", "ADMIN"] as const) {expect(canAccessTab(role, "meta-ads-agent")).toBe(true); expect(filterNavByRole(NAV_ITEMS, role).map(i => i.key)).toContain("meta-ads-agent");}
  expect(canAccessTab("STAFF", "meta-ads-agent")).toBe(false); expect(filterNavByRole(NAV_ITEMS, "STAFF").map(i => i.key)).not.toContain("meta-ads-agent");
  expect(canAccessTab("STAFF", "revenue-manager")).toBe(false);
});
