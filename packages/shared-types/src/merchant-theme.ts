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

export function merchantThemeTokens(theme: MerchantThemeAppearance, requestedMode = theme.mode ?? "light"): Record<string, string> {
  const mode = requestedMode === "grey" ? "grey" : requestedMode === "dark" ? "dark" : "light";
  const tokens: Record<string, string> = { ...NEUMORPHIC_THEME[mode === "light" ? "light" : "dark"] };
  if (mode === "grey") Object.assign(tokens, {
    "--aacp-bg": "#242726", "--aacp-surface": "#2d312f", "--aacp-card": "#333835",
    "--aacp-surface-2": "#292d2b", "--aacp-surface-3": "#3b413d",
    "--aacp-panel-bg": "#2d312f", "--aacp-shell-bg": "#242726", "--aacp-header-bg": "#2d312f",
    "--aacp-inset-bg": "#292d2b", "--aacp-sheet": "#2d312f", "--aacp-surface-elevated": "#3b413d",
  });
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
  if (theme.accentColor) tokens["--aacp-accent"] = theme.accentColor;
  if (theme.secondaryColor) tokens["--aacp-accent-2"] = theme.secondaryColor;
  if (theme.fontFamily) tokens["--aacp-font"] = theme.fontFamily;
  if (theme.fontDisplay || theme.fontFamily) tokens["--aacp-font-display"] = theme.fontDisplay || theme.fontFamily!;
  const radius = typeof theme.borderRadius === "number" && Number.isFinite(theme.borderRadius) ? Math.max(0, Math.min(64, theme.borderRadius)) : 8;
  tokens["--aacp-radius"] = `${radius}px`;
  tokens["--aacp-shell-max-width"] = theme.density === "compact" ? "480px" : theme.density === "comfortable" ? "680px" : "100%";
  return tokens;
}
