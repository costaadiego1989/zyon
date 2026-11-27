import { describe, it, expect } from "vitest";
import { canAccessTab, filterNavByRole } from "../../lib/auth/permissions.js";
import { NAV_ITEMS } from "../../shell/nav-config.js";
import {
  readMarketingNavigation,
  marketingHash,
} from "../../shell/marketing-navigation.js";
describe("MKT-08/3 merchant marketing navigation", () => {
  it("exposes both merchant areas to authenticated staff and fails closed while role is unresolved", () => {
    for (const key of ["marketing", "conversations"] as const) {
      expect(canAccessTab("STAFF", key)).toBe(true);
      expect(canAccessTab("ADMIN", key)).toBe(true);
      expect(canAccessTab(undefined, key)).toBe(false);
      expect(
        filterNavByRole(NAV_ITEMS, "STAFF").some((item) => item.key === key)
      ).toBe(true);
    }
    expect(NAV_ITEMS.find((item) => item.key === "marketing")?.label).toBe(
      "Marketing"
    );
    expect(NAV_ITEMS.find((item) => item.key === "conversations")?.label).toBe(
      "Conversas"
    );
    expect(
      NAV_ITEMS.find((item) => item.key === "crm-integrations")?.label
    ).toBe("Integrações com CRM");
  });
  it("connects contact profiles to conversations with bounded identifiers and explicit destination", () => {
    const id = "af9173f1-ea86-45e4-9372-e229111835a0";
    expect(
      readMarketingNavigation(
        `#${marketingHash("marketing", { contactId: id })}`
      )
    ).toEqual({ contactId: id, conversationId: undefined, view: "contacts" });
    expect(
      readMarketingNavigation(
        `#${marketingHash("conversations", { conversationId: id })}`
      ).conversationId
    ).toBe(id);
    expect(
      readMarketingNavigation(
        "#marketing?contactId=../../foreign&view=campaigns"
      )
    ).toEqual({
      contactId: undefined,
      conversationId: undefined,
      view: "campaigns",
    });
  });
});
