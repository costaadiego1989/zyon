/**
 * Theme Page — Unit Tests
 * TDD Phase: Tests written BEFORE implementation (RED → GREEN)
 */
import { describe, expect, it } from "vitest";
import {
  COLOR_FIELDS,
  DENSITY_OPTIONS,
  isValidUrl,
  parseBadges,
  canAddBadge,
  computeDirty,
  LABELS,
} from "./theme-page.js";
import { DEFAULT_MERCHANT_THEME, type MerchantTheme } from "@zyon/shared-types";

// ── URL Validation ───────────────────────────────────────────────────────────

describe("isValidUrl", () => {
  it("returns true for empty string (optional field)", () => {
    expect(isValidUrl("")).toBe(true);
  });

  it("returns true for valid https URL", () => {
    expect(isValidUrl("https://example.com/logo.png")).toBe(true);
  });

  it("returns true for valid http URL", () => {
    expect(isValidUrl("http://cdn.example.com/img.jpg")).toBe(true);
  });

  it("returns false for invalid URL", () => {
    expect(isValidUrl("not-a-url")).toBe(false);
  });

  it("returns false for ftp protocol", () => {
    expect(isValidUrl("ftp://files.example.com/a.png")).toBe(false);
  });

  it("returns false for javascript protocol", () => {
    expect(isValidUrl("javascript:alert(1)")).toBe(false);
  });
});

// ── Badge Parsing ────────────────────────────────────────────────────────────

describe("parseBadges", () => {
  it("splits comma-separated badges and trims", () => {
    expect(parseBadges("Frete, PIX , Seguro")).toEqual(["Frete", "PIX", "Seguro"]);
  });

  it("filters empty entries", () => {
    expect(parseBadges(",,,")).toEqual([]);
  });

  it("limits to 4 badges", () => {
    expect(parseBadges("A,B,C,D,E")).toEqual(["A", "B", "C", "D"]);
  });

  it("returns empty array for empty string", () => {
    expect(parseBadges("")).toEqual([]);
  });
});

describe("canAddBadge", () => {
  it("returns true when less than 4 badges", () => {
    expect(canAddBadge("A,B,C")).toBe(true);
  });

  it("returns false when 4 badges exist", () => {
    expect(canAddBadge("A,B,C,D")).toBe(false);
  });

  it("returns true for empty text", () => {
    expect(canAddBadge("")).toBe(true);
  });
});

// ── Dirty State Detection ────────────────────────────────────────────────────

describe("computeDirty", () => {
  const base: MerchantTheme = { ...DEFAULT_MERCHANT_THEME };

  it("returns false when theme and badges are unchanged", () => {
    expect(computeDirty(base, "Frete, PIX", base, "Frete, PIX")).toBe(false);
  });

  it("detects dirty when a color changes", () => {
    const modified = { ...base, accentColor: "#FF0000" };
    expect(computeDirty(modified, "", base, "")).toBe(true);
  });

  it("detects dirty when badges text changes", () => {
    expect(computeDirty(base, "Frete, PIX", base, "Frete")).toBe(true);
  });

  it("ignores whitespace-only differences in badges", () => {
    expect(computeDirty(base, "Frete,PIX", base, "Frete, PIX")).toBe(false);
  });
});

// ── COLOR_FIELDS Configuration ───────────────────────────────────────────────

describe("COLOR_FIELDS", () => {
  it("contains 10 color fields", () => {
    expect(COLOR_FIELDS).toHaveLength(10);
  });

  it("includes secondaryColor", () => {
    expect(COLOR_FIELDS.find((f) => f.key === "secondaryColor")).toBeDefined();
  });

  it("has secondaryColor labeled with 'Cor secundária'", () => {
    const field = COLOR_FIELDS.find((f) => f.key === "secondaryColor");
    expect(field?.label).toContain("Cor secundária");
  });

  it("has accentColor labeled with 'Cor principal'", () => {
    const field = COLOR_FIELDS.find((f) => f.key === "accentColor");
    expect(field?.label).toContain("Cor principal");
  });

  it("has all labels in Portuguese (no English-only terms)", () => {
    const englishOnly = ["Accent", "Background", "Surface"];
    for (const field of COLOR_FIELDS) {
      for (const eng of englishOnly) {
        expect(field.label).not.toBe(eng);
      }
    }
  });
});

// ── DENSITY_OPTIONS ──────────────────────────────────────────────────────────

describe("DENSITY_OPTIONS", () => {
  it("has 3 options", () => {
    expect(DENSITY_OPTIONS).toHaveLength(3);
  });

  it("uses Portuguese labels", () => {
    const labels = DENSITY_OPTIONS.map((o) => o.label);
    expect(labels).toContain("Estreito");
    expect(labels).toContain("Médio");
    expect(labels).toContain("Full");
  });

  it("maps to correct density values", () => {
    const values = DENSITY_OPTIONS.map((o) => o.value);
    expect(values).toEqual(["compact", "comfortable", "spacious"]);
  });
});

// ── LABELS (Portuguese Localization) ─────────────────────────────────────────

describe("LABELS", () => {
  it("has correct diacritics on 'necessário'", () => {
    expect(LABELS.loginRequired).toBe("Login necessário.");
  });

  it("has tenant subtitle about personalization", () => {
    expect(LABELS.tenantSubtitle).toContain("Personalize");
  });

  it("has 'Nome da loja'", () => {
    expect(LABELS.headerTitle).toBe("Nome da loja");
  });

  it("has 'Subtítulo da loja'", () => {
    expect(LABELS.headerSubtitle).toBe("Subtítulo da loja");
  });

  it("has 'Selos de confiança'", () => {
    expect(LABELS.badges).toBe("Selos de confiança");
  });

  it("has 'Tipografia da interface'", () => {
    expect(LABELS.fontUi).toBe("Tipografia da interface");
  });

  it("has 'Tipografia de destaque'", () => {
    expect(LABELS.fontDisplay).toBe("Tipografia de destaque");
  });

  it("has 'Arredondamento'", () => {
    expect(LABELS.borderRadius).toBe("Arredondamento");
  });

  it("has 'Imagens e layout'", () => {
    expect(LABELS.assetsLayout).toBe("Imagens e layout");
  });

  it("has 'Restaurar padrão'", () => {
    expect(LABELS.reset).toBe("Restaurar padrão");
  });

  it("has 'Tema salvo com sucesso.'", () => {
    expect(LABELS.saveSuccess).toBe("Tema salvo com sucesso.");
  });

  it("has reset confirmation message with correct text", () => {
    expect(LABELS.resetConfirm).toBe("Restaurar o tema padrão? Suas alterações não salvas serão perdidas.");
  });

  it("has URL validation error message", () => {
    expect(LABELS.urlInvalid).toBe("URL inválida — use https://...");
  });
});
