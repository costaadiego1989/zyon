import { expect, it } from "vitest";
import { canAccessTab, filterNavByRole } from "../../lib/auth/permissions.js";
import { NAV_ITEMS, visibleItemsForPlan } from "../../shell/nav-config.js";

it("CB-04 makes cashback available in every merchant plan and restricts the console tab to owner/admin", () => {
  for (const plan of ["CHECKOUT_ONLY", "STORE_ONLY", "BOTH", "API"] as const) {
    expect(visibleItemsForPlan(NAV_ITEMS, plan).filter(item => item.key === "cashback")).toHaveLength(1);
  }
  expect(canAccessTab("OWNER", "cashback")).toBe(true);
  expect(canAccessTab("ADMIN", "cashback")).toBe(true);
  expect(canAccessTab("STAFF", "cashback")).toBe(false);
  expect(filterNavByRole(NAV_ITEMS, "STAFF").some(item => item.key === "cashback")).toBe(false);
});
