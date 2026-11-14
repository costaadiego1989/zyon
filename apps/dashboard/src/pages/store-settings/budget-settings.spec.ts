import { describe, expect, it } from "vitest";
import { normalizeBudgetSettings, readBudgetSettings, validateBudgetSettings } from "./budget-settings.js";

describe("Budget settings contract", () => {
  it("loads the canonical store budget instead of widget defaults", () => {
    expect(readBudgetSettings({ budget: { enabled: true, email: "loja@example.test", whatsapp: "5511999999999" }, widgetBehavior: { budgetModeEnabled: false } })).toEqual({ enabled: true, email: "loja@example.test", whatsapp: "5511999999999" });
  });

  it("does not turn an unsupported or invalid response into an editable disabled mode", () => {
    for (const budget of [undefined, null, [], {}, { enabled: "true" }, { enabled: true, email: 42 }, { enabled: false, whatsapp: false }]) {
      expect(readBudgetSettings({ budget })).toBeNull();
    }
  });

  it("allows an explicitly disabled mode with optional destinations", () => {
    expect(readBudgetSettings({ budget: { enabled: false, email: null, whatsapp: null } })).toEqual({ enabled: false, email: "", whatsapp: "" });
    expect(validateBudgetSettings({ enabled: true, email: "", whatsapp: "" })).toEqual({});
  });

  it("normalizes email whitespace and international telephone formatting without changing the mode", () => {
    expect(normalizeBudgetSettings({ enabled: false, email: " loja@example.test ", whatsapp: "+55 (11) 99999-9999" })).toEqual({ enabled: false, email: "loja@example.test", whatsapp: "5511999999999" });
  });

  it("rejects malformed email and phone even while the mode is disabled", () => {
    const errors = validateBudgetSettings({ enabled: false, email: "loja@", whatsapp: "123" });
    expect(errors.email).toBeTruthy();
    expect(errors.whatsapp).toBeTruthy();
  });

  it("accepts the API telephone bounds and rejects values outside them", () => {
    for (const length of [10, 15]) expect(validateBudgetSettings({ enabled: true, email: "", whatsapp: "1".repeat(length) })).toEqual({});
    for (const length of [9, 16]) expect(validateBudgetSettings({ enabled: true, email: "", whatsapp: "1".repeat(length) }).whatsapp).toBeTruthy();
    expect(validateBudgetSettings({ enabled: true, email: "", whatsapp: " ".repeat(33) + "11999999999" }).whatsapp).toBeUndefined();
  });

  it("rejects an email longer than the API limit", () => {
    expect(validateBudgetSettings({ enabled: true, email: "a".repeat(250) + "@example.test", whatsapp: "" }).email).toBeTruthy();
  });
});
