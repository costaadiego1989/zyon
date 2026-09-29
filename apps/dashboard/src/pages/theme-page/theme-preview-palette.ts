import { DEFAULT_MERCHANT_THEME, merchantThemeTokens, type MerchantTheme } from "@zyon/shared-types";

const PALETTE_FIELDS = {
  backgroundColor: "--aacp-bg",
  textColor: "--aacp-fg",
  surfaceColor: "--aacp-surface",
  surfaceElevatedColor: "--aacp-surface-elevated",
  borderColor: "--aacp-line",
  mutedTextColor: "--aacp-muted",
} as const;

/** Old saved themes may predate mode and surface fields. Complete their palette
 * from their actual background instead of adding white cards to a dark theme. */
export function normalizeThemeDraft(saved?: Partial<MerchantTheme> | null): MerchantTheme {
  const background = saved?.backgroundColor;
  let inferredMode: MerchantTheme["mode"] = "light";
  if (background && /^#[0-9a-f]{6}$/i.test(background)) {
    const [r, g, b] = [1, 3, 5].map(index => parseInt(background.slice(index, index + 2), 16) / 255);
    if (0.2126 * r + 0.7152 * g + 0.0722 * b < 0.5) inferredMode = "dark";
  }
  const mode = saved?.mode ?? inferredMode;
  const palette = merchantThemeTokens({ ...DEFAULT_MERCHANT_THEME, mode });
  const defaults = Object.fromEntries(Object.entries(PALETTE_FIELDS).map(([field, token]) => [field, palette[token]]));
  const next = { ...DEFAULT_MERCHANT_THEME, ...defaults, ...saved, mode };
  // The shared renderer replaces light defaults in dark/grey modes. Show those
  // effective values in the editor too, so inputs and preview describe one theme.
  const effective = merchantThemeTokens(next);
  return { ...next, ...Object.fromEntries(Object.entries(PALETTE_FIELDS).map(([field, token]) => [field, effective[token]])) };
}

/** Choosing a mode is an explicit palette change; identity stays untouched. */
export function applyThemeMode(theme: MerchantTheme, mode: NonNullable<MerchantTheme["mode"]>): MerchantTheme {
  const palette = merchantThemeTokens({ ...DEFAULT_MERCHANT_THEME, mode });
  return { ...theme, mode, ...Object.fromEntries(Object.entries(PALETTE_FIELDS).map(([field, token]) => [field, palette[token]])) };
}

/** Keep the shared palette contract, but isolate its CSS properties from the
 * dashboard and any embedded checkout loaded on the same page. */
export function themePreviewTokens(theme: MerchantTheme): Record<string, string> {
  return Object.fromEntries(Object.entries(merchantThemeTokens(theme)).map(([name, value]) => [
    name.replace("--aacp-", "--theme-preview-"),
    value.replaceAll("--aacp-", "--theme-preview-"),
  ]));
}
