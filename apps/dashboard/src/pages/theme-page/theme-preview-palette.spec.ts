import { describe, expect, it } from "vitest";
import { DEFAULT_MERCHANT_THEME } from "@zyon/shared-types";
import { applyThemeMode, normalizeThemeDraft, themePreviewTokens } from "./theme-preview-palette.js";

describe("theme preview palette", () => {
  it("completes a legacy dark theme without white cards or losing its identity", () => {
    const theme = normalizeThemeDraft({ backgroundColor: "#101d17", textColor: "#e9f1ed", agentName: "Nina", borderRadius: 0 });
    expect(theme.mode).toBe("dark");
    expect(theme.surfaceColor).toBe("#1d2421");
    expect(theme.backgroundColor).toBe("#101d17");
    expect(theme.textColor).toBe("#e9f1ed");
    expect(theme.agentName).toBe("Nina");
    expect(theme.borderRadius).toBe(0);
  });

  it("replaces incompatible neutral colors on explicit mode selection and survives reload", () => {
    const legacy = normalizeThemeDraft({ backgroundColor: "#101d17", textColor: "#e9f1ed", accentColor: "#123456", agentName: "Nina", logoUrl: "https://example.test/logo.svg", borderRadius: 0 });
    const light = applyThemeMode(legacy, "light");
    expect(light.backgroundColor.toLowerCase()).toBe(DEFAULT_MERCHANT_THEME.backgroundColor.toLowerCase());
    expect(light.textColor.toLowerCase()).toBe(DEFAULT_MERCHANT_THEME.textColor.toLowerCase());
    expect(light.accentColor).toBe(legacy.accentColor);
    expect(light.logoUrl).toBe(legacy.logoUrl);
    expect(light.agentName).toBe(legacy.agentName);
    expect(light.borderRadius).toBe(0);
    expect(normalizeThemeDraft(JSON.parse(JSON.stringify(light)))).toEqual(light);
    const dark = applyThemeMode(light, "dark");
    const grey = applyThemeMode(dark, "grey");
    expect(grey.backgroundColor).not.toBe(dark.backgroundColor);
    expect(normalizeThemeDraft(JSON.parse(JSON.stringify(grey)))).toEqual(grey);
  });

  it("keeps explicit custom colors in the selected mode and isolates CSS references", () => {
    const theme = normalizeThemeDraft({ ...DEFAULT_MERCHANT_THEME, mode: "light", backgroundColor: "#e1e9f0", textColor: "#182532", surfaceColor: "#f4f8fc", borderRadius: 0 });
    const tokens = themePreviewTokens(theme);
    expect(tokens["--theme-preview-bg"]).toBe("#e1e9f0");
    expect(tokens["--theme-preview-card"]).toBe("#f4f8fc");
    expect(tokens["--theme-preview-radius"]).toBe("0px");
    expect(JSON.stringify(tokens)).not.toContain("--aacp-");
  });
});
