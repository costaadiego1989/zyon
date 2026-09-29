import { describe, expect, it } from "vitest";
import { formatBudgetPhone } from "./budget-phone.js";
import { normalizeBudgetSettings, validateBudgetSettings } from "./budget-settings.js";

describe("Budget contact phone formatting", () => {
  it("formats Brazilian landline, mobile and country code without losing digits", () => {
    expect(formatBudgetPhone("1133334444")).toBe("(11) 3333-4444");
    expect(formatBudgetPhone("11999998888")).toBe("(11) 99999-8888");
    expect(formatBudgetPhone("5511999998888")).toBe("+55 (11) 99999-8888");
  });

  it("round-trips international destinations through the canonical budget payload", () => {
    for (const phone of ["+1 415 555 2671", "+351 912 345 678", "+44 20 7946 0018", "+123456789012345"]) {
      const formatted = formatBudgetPhone(phone);
      const settings = { enabled: true, email: "", whatsapp: formatted };
      expect(formatted.startsWith("+")).toBe(true);
      expect(validateBudgetSettings(settings)).toEqual({});
      expect(normalizeBudgetSettings(settings).whatsapp).toBe(phone.replace(/\D/g, ""));
    }
  });

  it("keeps invalid lengths visible for validation instead of truncating the recipient", () => {
    for (const phone of ["123456789", "+1234567890123456"]) {
      const formatted = formatBudgetPhone(phone);
      expect(formatted.replace(/\D/g, "")).toBe(phone.replace(/\D/g, ""));
      expect(validateBudgetSettings({ enabled: true, email: "", whatsapp: formatted }).whatsapp).toBeTruthy();
    }
  });

  it("can clear the contact and does not change the mode", () => {
    expect(formatBudgetPhone("")).toBe("");
    expect(normalizeBudgetSettings({ enabled: false, email: "", whatsapp: formatBudgetPhone("") })).toEqual({ enabled: false, email: "", whatsapp: "" });
  });
});
