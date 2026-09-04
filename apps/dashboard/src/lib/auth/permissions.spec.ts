import { describe, it, expect } from "vitest";
import { canAccessTab, filterNavByRole } from "./permissions.js";
import { NAV_ITEMS } from "../../shell/nav-config.js";

describe("canAccessTab", () => {
  it("allows OWNER everywhere", () => {
    expect(canAccessTab("OWNER", "catalog")).toBe(true);
    expect(canAccessTab("OWNER", "team")).toBe(true);
  });

  it("allows STAFF only on the restricted allow-list", () => {
    expect(canAccessTab("STAFF", "overview")).toBe(true);
    expect(canAccessTab("STAFF", "shipments")).toBe(true);
    expect(canAccessTab("STAFF", "support")).toBe(true);
    expect(canAccessTab("STAFF", "account-settings")).toBe(true);
    expect(canAccessTab("STAFF", "catalog")).toBe(false);
    expect(canAccessTab("STAFF", "team")).toBe(false);
    expect(canAccessTab("STAFF", "billing")).toBe(false);
  });

  it("allows ADMIN on most things except billing-plans-only-OWNER", () => {
    expect(canAccessTab("ADMIN", "catalog")).toBe(true);
    expect(canAccessTab("ADMIN", "billing-plans")).toBe(false);
  });

  it("falls back to allow when role is missing (defensive)", () => {
    expect(canAccessTab(undefined, "overview")).toBe(true);
  });
});

describe("filterNavByRole", () => {
  it("returns just the STAFF items", () => {
    const items = filterNavByRole(NAV_ITEMS, "STAFF");
    const keys = items.map((i) => i.key);
    expect(keys).toContain("overview");
    expect(keys).toContain("shipments");
    expect(keys).toContain("support");
    expect(keys).toContain("funnel");
    expect(keys).toContain("customers");
    expect(keys).toContain("account-settings");
    expect(keys).toContain("marketplace");
    expect(keys).not.toContain("catalog");
    expect(keys).not.toContain("team");
    expect(keys).not.toContain("billing");
  });
});
