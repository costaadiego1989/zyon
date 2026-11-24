import { describe, it, expect } from "vitest";
import { NAV_ITEMS, navigationForBusiness, visibleItemsForPlan, type MerchantPlan } from "./nav-config.js";
import { filterNavByRole, canAccessTab } from "../lib/auth/permissions.js";

const services = { id: "merchant-a", user_id: "owner-a", role: "OWNER" as const, businessMode: "services" as const, businessModeSelectionState: "selected" as const };
const products = { ...services, businessMode: "products" as const };
const keys = (profile: Parameters<typeof navigationForBusiness>[1], plan: MerchantPlan = "BOTH") =>
  filterNavByRole(visibleItemsForPlan(navigationForBusiness(NAV_ITEMS, profile), plan), profile?.role).map(item => item.key);

describe("T82 business navigation", () => {
  it.each(["CHECKOUT_ONLY", "STORE_ONLY", "BOTH", "API"] as const)("products retain their orders, catalog and support rules for plan %s", plan => {
    const original = visibleItemsForPlan(NAV_ITEMS.filter(item => !["service-attendance", "service-appointments"].includes(item.key)), plan);
    expect(keys(products, plan)).toEqual(filterNavByRole(original, products.role).map(item => item.key));
    expect(navigationForBusiness(NAV_ITEMS, products).find(item => item.key === "catalog")?.label).toBe("Produtos");
    expect(navigationForBusiness(NAV_ITEMS, products).find(item => item.key === "support")?.label).toBe("Suporte");
  });
  it.each(["OWNER", "ADMIN"] as const)("selected service businesses receive distinct daily appointments and attendance management for %s", role => {
    const profile = { ...services, role }, items = navigationForBusiness(NAV_ITEMS, profile);
    expect(items.some(item => item.key === "shipments")).toBe(false);
    expect(keys(profile)).toContain("service-appointments"); expect(keys(profile)).toContain("service-attendance");
    expect(items.find(item => item.key === "service-appointments")?.label).toBe("Agendamentos");
    expect(items.find(item => item.key === "service-attendance")?.label).toBe("Atendimento");
    expect(items.find(item => item.key === "catalog")?.label).toBe("Serviços");
    expect(items.find(item => item.key === "service-appointments")?.badgeKey).toBeUndefined();
  });
  it("business mode never rewrites plan entitlements or promotes a staff role", () => {
    for (const plan of ["CHECKOUT_ONLY", "STORE_ONLY", "BOTH", "API"] as const) {
      const owner = keys(services, plan); expect(owner).toContain("service-appointments"); expect(owner).toContain("service-attendance");
      const staff = keys({ ...services, role: "STAFF" }, plan); expect(staff).not.toContain("service-appointments"); expect(staff).not.toContain("service-attendance");
      expect(staff).toContain("support"); expect(canAccessTab("STAFF", "service-attendance")).toBe(false); expect(canAccessTab("STAFF", "service-appointments")).toBe(false);
      for (const existing of ["catalog", "finance", "payment-connections"] as const)
        expect(owner.includes(existing)).toBe(keys(products, plan).includes(existing));
    }
  });
  it("missing, unselected and review-required identities cannot receive service management shortcuts", () => {
    for (const profile of [null, { ...services, id: "" }, { ...services, user_id: "" }, { ...services, role: undefined },
      { ...services, businessModeSelectionState: "review_required" }, { ...services, businessModeSelectionState: undefined }]) {
      expect(keys(profile as never)).not.toContain("service-attendance"); expect(keys(profile as never)).not.toContain("service-appointments");
    }
  });
  it("retains the historical orders definition and never mutates shared navigation when switching companies", () => {
    const before = NAV_ITEMS.map(item => ({ ...item })); const serviceItems = navigationForBusiness(NAV_ITEMS, services);
    expect(serviceItems.some(item => item.key === "shipments")).toBe(false);
    expect(keys(products)).toContain("shipments"); expect(NAV_ITEMS).toEqual(before);
    expect(NAV_ITEMS.find(item => item.key === "shipments")?.label).toBe("Pedidos e envios");
  });
});
