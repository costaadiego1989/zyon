import { describe, expect, it } from "vitest";
import {
  validateThemeDraft,
  validateRulesDraft,
  validateCheckoutDraft,
  friendlyError,
  isValidHexColor,
  isValidUrl,
  type ThemeDraft,
  type RulesDraft,
  type CheckoutDraft,
} from "./schemas.js";
import { DashboardHttpError } from "../../../api-client.js";

const VALID_THEME: ThemeDraft = {
  accentColor: "#0F766E",
  logoUrl: "https://example.com/logo.png",
  headerTitle: "Minha Loja",
  agentName: "Zara",
};

const VALID_RULES: RulesDraft = {
  maxDiscountPercent: 10,
  minimumMarginPercent: 38,
  allowFreeShipping: true,
};

describe("isValidHexColor", () => {
  it("accepts valid 6-digit hex", () => {
    expect(isValidHexColor("#0F766E")).toBe(true);
    expect(isValidHexColor("#ffffff")).toBe(true);
    expect(isValidHexColor("#000000")).toBe(true);
  });

  it("rejects invalid formats", () => {
    expect(isValidHexColor("0F766E")).toBe(false);
    expect(isValidHexColor("#0F7")).toBe(false);
    expect(isValidHexColor("#0F766EFF")).toBe(false);
    expect(isValidHexColor("red")).toBe(false);
    expect(isValidHexColor("")).toBe(false);
  });
});

describe("isValidUrl", () => {
  it("accepts https URLs", () => {
    expect(isValidUrl("https://example.com/logo.png")).toBe(true);
  });

  it("accepts http URLs", () => {
    expect(isValidUrl("http://example.com/logo.png")).toBe(true);
  });

  it("rejects non-URL strings", () => {
    expect(isValidUrl("not-a-url")).toBe(false);
    expect(isValidUrl("")).toBe(false);
    expect(isValidUrl("ftp://example.com")).toBe(false);
  });
});

describe("validateThemeDraft", () => {
  it("returns no errors for a valid draft", () => {
    const result = validateThemeDraft(VALID_THEME);
    expect(result).toHaveLength(0);
  });

  it("returns error when headerTitle is empty", () => {
    const result = validateThemeDraft({ ...VALID_THEME, headerTitle: "" });
    expect(result).toContainEqual(
      expect.objectContaining({ valid: false, field: "headerTitle" }),
    );
  });

  it("returns error when headerTitle is whitespace only", () => {
    const result = validateThemeDraft({ ...VALID_THEME, headerTitle: "   " });
    expect(result).toContainEqual(
      expect.objectContaining({ valid: false, field: "headerTitle" }),
    );
  });

  it("returns error when agentName is empty", () => {
    const result = validateThemeDraft({ ...VALID_THEME, agentName: "" });
    expect(result).toContainEqual(
      expect.objectContaining({ valid: false, field: "agentName" }),
    );
  });

  it("returns error when logoUrl is not a valid URL", () => {
    const result = validateThemeDraft({ ...VALID_THEME, logoUrl: "not-a-url" });
    expect(result).toContainEqual(
      expect.objectContaining({ valid: false, field: "logoUrl" }),
    );
  });

  it("allows empty logoUrl (optional field)", () => {
    const result = validateThemeDraft({ ...VALID_THEME, logoUrl: "" });
    const logoErrors = result.filter((r) => !r.valid && "field" in r && r.field === "logoUrl");
    expect(logoErrors).toHaveLength(0);
  });

  it("returns error when accentColor is not a valid hex", () => {
    const result = validateThemeDraft({ ...VALID_THEME, accentColor: "red" });
    expect(result).toContainEqual(
      expect.objectContaining({ valid: false, field: "accentColor" }),
    );
  });
});

describe("validateRulesDraft", () => {
  it("returns no errors for valid ranges", () => {
    const result = validateRulesDraft(VALID_RULES);
    expect(result).toHaveLength(0);
  });

  it("returns error when maxDiscountPercent > 30", () => {
    const result = validateRulesDraft({ ...VALID_RULES, maxDiscountPercent: 31 });
    expect(result).toContainEqual(
      expect.objectContaining({ valid: false, field: "maxDiscountPercent" }),
    );
  });

  it("returns error when maxDiscountPercent < 0", () => {
    const result = validateRulesDraft({ ...VALID_RULES, maxDiscountPercent: -1 });
    expect(result).toContainEqual(
      expect.objectContaining({ valid: false, field: "maxDiscountPercent" }),
    );
  });

  it("returns error when minimumMarginPercent > 100", () => {
    const result = validateRulesDraft({ ...VALID_RULES, minimumMarginPercent: 101 });
    expect(result).toContainEqual(
      expect.objectContaining({ valid: false, field: "minimumMarginPercent" }),
    );
  });

  it("returns error when minimumMarginPercent < 0", () => {
    const result = validateRulesDraft({ ...VALID_RULES, minimumMarginPercent: -1 });
    expect(result).toContainEqual(
      expect.objectContaining({ valid: false, field: "minimumMarginPercent" }),
    );
  });

  it("returns error when minimumMarginPercent <= maxDiscountPercent", () => {
    const result = validateRulesDraft({ ...VALID_RULES, maxDiscountPercent: 15, minimumMarginPercent: 15 });
    expect(result).toContainEqual(
      expect.objectContaining({ valid: false, field: "minimumMarginPercent" }),
    );
  });

  it("returns error when minimumMarginPercent < maxDiscountPercent", () => {
    const result = validateRulesDraft({ ...VALID_RULES, maxDiscountPercent: 20, minimumMarginPercent: 10 });
    expect(result).toContainEqual(
      expect.objectContaining({ valid: false, field: "minimumMarginPercent" }),
    );
  });
});

describe("validateCheckoutDraft", () => {
  it("returns no errors (enum-constrained)", () => {
    const draft: CheckoutDraft = { mode: "proactive", openWidgetOnTrigger: true };
    const result = validateCheckoutDraft(draft);
    expect(result).toHaveLength(0);
  });
});

describe("friendlyError", () => {
  it("maps DashboardHttpError 401 to session expired message", () => {
    const err = new DashboardHttpError(401, "Unauthorized");
    expect(friendlyError(err)).toBe("Sessão expirada. Faça login novamente.");
  });

  it("maps DashboardHttpError 422 to invalid data message", () => {
    const err = new DashboardHttpError(422, "Unprocessable");
    expect(friendlyError(err)).toBe("Dados inválidos. Verifique os campos.");
  });

  it("maps DashboardHttpError 500+ to server error message", () => {
    const err = new DashboardHttpError(500, "Internal");
    expect(friendlyError(err)).toBe("Erro no servidor. Tente novamente.");
  });

  it("maps DashboardHttpError 503 to server error message", () => {
    const err = new DashboardHttpError(503, "Service Unavailable");
    expect(friendlyError(err)).toBe("Erro no servidor. Tente novamente.");
  });

  it("maps generic Error to unexpected error message", () => {
    const err = new Error("something");
    expect(friendlyError(err)).toBe("Erro inesperado. Tente novamente.");
  });

  it("maps unknown to unexpected error message", () => {
    expect(friendlyError("string error")).toBe("Erro inesperado. Tente novamente.");
    expect(friendlyError(null)).toBe("Erro inesperado. Tente novamente.");
    expect(friendlyError(undefined)).toBe("Erro inesperado. Tente novamente.");
  });
});
