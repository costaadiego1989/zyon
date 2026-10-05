/** Shared material colors only. Merchant accents, fonts and geometry stay local. */
export const NEUMORPHIC_THEME = {
  light: {
    "--aacp-bg": "#edf0ee",
    "--aacp-surface": "#edf0ee",
    "--aacp-surface-2": "#e8ede9",
    "--aacp-surface-3": "#e0e7e2",
    "--aacp-fg": "#202b24",
    "--aacp-accent-text": "color-mix(in oklab, var(--aacp-accent, #268235) 82%, var(--aacp-fg))",
    "--aacp-muted": "#53645a",
    "--aacp-faint": "#59695f",
    "--aacp-line": "#c9d3cc",
    "--aacp-line-strong": "#c2cec5",
    "--aacp-neu-control-line": "#7c8e81",
    "--aacp-card": "#f0f3f1",
    "--aacp-chip": "#edf0ee",
    "--aacp-success": "#187044",
    "--aacp-panel-bg": "#edf0ee",
    "--aacp-shell-bg": "#edf0ee",
    "--aacp-header-bg": "#edf0ee",
    "--aacp-inset-bg": "#e9eeeb",
    "--aacp-sheet": "#edf0ee",
    "--aacp-surface-elevated": "#f0f3f1",
    "--aacp-shadow-sm": "var(--aacp-neu-raised-sm)",
    "--aacp-shadow-md": "var(--aacp-neu-raised-md)",
    "--aacp-shadow-lg": "var(--aacp-neu-overlay)",
  },
  dark: {
    "--aacp-bg": "#191f1d",
    "--aacp-surface": "#1d2421",
    "--aacp-surface-2": "#191f1d",
    "--aacp-surface-3": "#28332d",
    "--aacp-fg": "#edf3ee",
    "--aacp-accent-text": "color-mix(in oklab, var(--aacp-accent, #268235) 66%, var(--aacp-fg))",
    "--aacp-muted": "#b0beb5",
    "--aacp-faint": "#99aa9f",
    "--aacp-line": "#37483e",
    "--aacp-line-strong": "#455b4c",
    "--aacp-neu-control-line": "#6c8274",
    "--aacp-card": "#202923",
    "--aacp-chip": "#1d2421",
    "--aacp-success": "#68d69c",
    "--aacp-panel-bg": "#1d2421",
    "--aacp-shell-bg": "#191f1d",
    "--aacp-header-bg": "#1d2421",
    "--aacp-inset-bg": "#202623",
    "--aacp-sheet": "#1d2421",
    "--aacp-surface-elevated": "#28332d",
    "--aacp-shadow-sm": "var(--aacp-neu-raised-sm)",
    "--aacp-shadow-md": "var(--aacp-neu-raised-md)",
    "--aacp-shadow-lg": "var(--aacp-neu-overlay)",
  },
} as const;


/** Theme mapping shared by the dashboard preview, storefront and both checkout hosts. */
export interface MerchantThemeAppearance {
  mode?: string; density?: string; borderRadius?: number;
  accentColor?: string; secondaryColor?: string; backgroundColor?: string; textColor?: string;
  surfaceColor?: string; surfaceElevatedColor?: string; borderColor?: string; mutedTextColor?: string;
  successColor?: string; warningColor?: string; fontFamily?: string; fontDisplay?: string;
}

function luminance(color: string): number | null {
  const match = color.trim().match(/^#([\da-f]{3}|[\da-f]{6})$/i);
  if (!match) return null;
  const hex = match[1].length === 3 ? [...match[1]].map((part) => part + part).join("") : match[1];
  const channels = [0, 2, 4].map((offset) => {
    const value = Number.parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}

function contrast(foreground: number, background: number): number {
  return (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05);
}

export function merchantThemeTokens(theme: MerchantThemeAppearance, requestedMode = theme.mode ?? "light"): Record<string, string> {
  const mode = requestedMode === "grey" ? "grey" : requestedMode === "dark" ? "dark" : "light";
  const tokens: Record<string, string> = { ...NEUMORPHIC_THEME[mode === "light" ? "light" : "dark"] };
  if (mode === "grey") Object.assign(tokens, {
    "--aacp-bg": "#242726", "--aacp-surface": "#2d312f", "--aacp-card": "#333835",
    "--aacp-surface-2": "#292d2b", "--aacp-surface-3": "#3b413d",
    "--aacp-panel-bg": "#2d312f", "--aacp-shell-bg": "#242726", "--aacp-header-bg": "#2d312f",
    "--aacp-inset-bg": "#292d2b", "--aacp-sheet": "#2d312f", "--aacp-surface-elevated": "#3b413d",
  });
  const defaults = { ...tokens };
  // Defaults are light colors. Do not carry those defaults into a dark palette.
  // Explicit custom colors remain authoritative in the merchant's chosen mode.
  const fields = [
    ["backgroundColor", "#f7f8fa", ["--aacp-bg", "--aacp-shell-bg", "--aacp-panel-bg"]],
    ["textColor", "#111827", ["--aacp-fg"]],
    ["surfaceColor", "#ffffff", ["--aacp-surface", "--aacp-card", "--aacp-header-bg", "--aacp-sheet"]],
    ["surfaceElevatedColor", "#f8fafc", ["--aacp-surface-elevated"]],
    ["borderColor", "#d9e2ec", ["--aacp-line", "--aacp-line-strong", "--aacp-border-color"]],
    ["mutedTextColor", "#64748b", ["--aacp-muted"]],
    ["successColor", "#047857", ["--aacp-success"]],
    ["warningColor", "#b45309", ["--aacp-warning"]],
  ] as const;
  for (const [field, defaultValue, names] of fields) {
    const value = theme[field];
    if (value && (mode === "light" || value.toLowerCase() !== defaultValue) && (requestedMode === (theme.mode ?? "light"))) {
      for (const name of names) tokens[name] = value;
    }
  }
  // Legacy themes can contain dark canvas/text colors alongside white cards,
  // even with no mode set. Resolve every neutral surface in the requested mode
  // before checking text, so SSR, hydration and toggling use one readable palette.
  const surfaces = [
    "--aacp-bg", "--aacp-shell-bg", "--aacp-panel-bg", "--aacp-surface",
    "--aacp-card", "--aacp-header-bg", "--aacp-sheet", "--aacp-surface-elevated",
    "--aacp-surface-2", "--aacp-surface-3", "--aacp-inset-bg", "--aacp-chip",
  ];
  for (const name of surfaces) {
    const lightness = luminance(tokens[name]);
    if (lightness !== null && (lightness > 0.179) !== (mode === "light")) tokens[name] = defaults[name];
  }
  const backgrounds = surfaces.map((name) => luminance(tokens[name])).filter((value): value is number => value !== null);
  for (const name of ["--aacp-fg", "--aacp-muted", "--aacp-faint"]) {
    const lightness = luminance(tokens[name]);
    if (lightness !== null && backgrounds.some((background) => contrast(lightness, background) < 4.5)) {
      tokens[name] = [defaults[name], defaults["--aacp-fg"], mode === "light" ? "#000000" : "#ffffff"]
        .find((color) => backgrounds.every((background) => contrast(luminance(color)!, background) >= 4.5))!;
    }
  }
  if (theme.accentColor) tokens["--aacp-accent"] = theme.accentColor;
  const accentLightness = luminance(theme.accentColor ?? "#268235");
  tokens["--aacp-on-accent"] = accentLightness !== null && contrast(1, accentLightness) < 4.5 ? "#000000" : "#ffffff";
  if (theme.secondaryColor) tokens["--aacp-accent-2"] = theme.secondaryColor;
  if (theme.fontFamily) tokens["--aacp-font"] = theme.fontFamily;
  if (theme.fontDisplay || theme.fontFamily) tokens["--aacp-font-display"] = theme.fontDisplay || theme.fontFamily!;
  const radius = typeof theme.borderRadius === "number" && Number.isFinite(theme.borderRadius) ? Math.max(0, Math.min(64, theme.borderRadius)) : 8;
  tokens["--aacp-radius"] = `${radius}px`;
  tokens["--aacp-shell-max-width"] = theme.density === "compact" ? "480px" : theme.density === "comfortable" ? "680px" : "100%";
  return tokens;
}
