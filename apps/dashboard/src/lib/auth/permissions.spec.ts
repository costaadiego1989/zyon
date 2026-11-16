import type { MerchantProfile } from "../../api-client.js";
import type { Role } from "./roles.js";
import { canUseWhatsAppConversations, canConfigureWhatsApp, canManageServiceAttendance, canAccessSensitiveSupportCapability } from "./permissions.js";
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
    expect(keys).not.toContain("marketplace");
    expect(keys).not.toContain("catalog");
    expect(keys).not.toContain("team");
    expect(keys).not.toContain("billing");
  });
});

describe("T59 sensitive support capabilities", () => {
  const roles = ["OWNER", "ADMIN", "STAFF"] as const;
  const modes = ["products", "services"] as const;
  const plans = [undefined, "CHECKOUT_ONLY", "STORE_ONLY", "BOTH", "API"] as const;
  const profile = (role: Role, businessMode: "products" | "services", plan?: MerchantProfile["plan"]): MerchantProfile => ({
    id: "merchant-current", user_id: "operator-current", name: "Synthetic company", role, businessMode, businessModeSelectionState: "selected", plan,
  });
  const matrix = roles.flatMap(role => modes.flatMap(mode => plans.map(plan => ({ role, mode, plan }))));

  it.each(matrix)("keeps role=$role mode=$mode plan=$plan independent", ({ role, mode, plan }) => {
    const current = profile(role, mode, plan), snapshot = { ...current };
    const management = role !== "STAFF" && mode === "services", configuration = role !== "STAFF";
    expect(canUseWhatsAppConversations(role)).toBe(true);
    expect(canConfigureWhatsApp(role)).toBe(configuration);
    expect(canManageServiceAttendance(current)).toBe(management);
    expect(canAccessSensitiveSupportCapability(current, "whatsapp-conversations")).toBe(true);
    expect(canAccessSensitiveSupportCapability(current, "whatsapp-configuration")).toBe(configuration);
    expect(canAccessSensitiveSupportCapability(current, "service-attendance:manage")).toBe(management);
    expect(current).toEqual(snapshot);
  });

  it.each([undefined, null, "owner", "ROOT", "", 0, {}, []].map(role => ({ role })))("denies unknown canonical role %j without the pre-session fallback", ({ role }) => {
    expect(canUseWhatsAppConversations(role)).toBe(false); expect(canConfigureWhatsApp(role)).toBe(false);
    const current = { ...profile("OWNER", "services", "BOTH"), role } as unknown as MerchantProfile;
    expect(canManageServiceAttendance(current)).toBe(false);
    for (const target of ["whatsapp-conversations", "whatsapp-configuration", "service-attendance:manage"]) expect(canAccessSensitiveSupportCapability(current, target)).toBe(false);
  });

  it.each([undefined, null, {}, { id: "", user_id: "actor", role: "OWNER" }, { id: "merchant", user_id: "", role: "OWNER" }])("denies missing or incomplete authenticated profile %j", value => {
    const current = value as MerchantProfile | null | undefined;
    expect(canManageServiceAttendance(current)).toBe(false);
    for (const target of ["whatsapp-conversations", "whatsapp-configuration", "service-attendance:manage"]) expect(canAccessSensitiveSupportCapability(current, target)).toBe(false);
  });

  it.each([undefined, "legacy", "review_required", "unexpected"])("does not infer selected services from classification %s", state => {
    const current = { ...profile("OWNER", "services", "BOTH"), businessModeSelectionState: state } as MerchantProfile;
    expect(canManageServiceAttendance(current)).toBe(false); expect(canAccessSensitiveSupportCapability(current, "service-attendance:manage")).toBe(false);
  });

  it.each([undefined, "", "unknown", "service-attendance", "whatsapp-seller", "__proto__"])("denies unknown sensitive target %j even for an owner", target => {
    expect(canAccessSensitiveSupportCapability(profile("OWNER", "services", "BOTH"), target)).toBe(false);
  });

  it("preserves staff support while unresolved service classification grants no management or configuration", () => {
    const current = { ...profile("STAFF", "services", "API"), businessModeSelectionState: "review_required" as const };
    expect(canAccessSensitiveSupportCapability(current, "whatsapp-conversations")).toBe(true);
    expect(canAccessSensitiveSupportCapability(current, "service-attendance:manage")).toBe(false);
    expect(canAccessSensitiveSupportCapability(current, "whatsapp-configuration")).toBe(false);
  });

  it("keeps the old pre-session navigation contract separate from new sensitive permissions", () => {
    expect(canAccessTab(undefined, "overview")).toBe(true);
    expect(canUseWhatsAppConversations(undefined)).toBe(false); expect(canConfigureWhatsApp(undefined)).toBe(false);
  });
});
