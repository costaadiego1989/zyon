import type { BrandConfig } from "@/api/checkout-session";

const STRING_FIELDS = [
  "name", "subtitle", "logoUrl", "accentColor", "secondaryColor", "backgroundColor",
  "textColor", "fontFamily", "fontDisplay", "borderColor", "surfaceColor",
  "surfaceElevatedColor", "mutedTextColor", "successColor", "warningColor",
  "backgroundImageUrl", "favicon", "agentAvatarUrl", "agentName",
] as const;

type ThemeStringField = (typeof STRING_FIELDS)[number];
export type ThemePreviewUpdate = Pick<BrandConfig, Exclude<ThemeStringField, "agentName"> | "borderRadius" | "mode" | "density"> & {
  agentName?: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Accept only theme updates posted by the document that owns the widget frame.
 * The preview uses srcDoc, which inherits the dashboard origin, so a same-origin
 * check is both compatible with preview and prevents arbitrary embedding pages
 * from changing the checkout appearance.
 */
export function parseThemePreviewUpdate(
  event: Pick<MessageEvent, "data" | "origin" | "source">,
  expectedOrigin: string,
  parentWindow: WindowProxy | null,
): ThemePreviewUpdate | null {
  if (event.origin !== expectedOrigin || event.source !== parentWindow || !isRecord(event.data)) return null;
  if (event.data.type !== "THEME_UPDATE" || !isRecord(event.data.payload)) return null;

  const payload = event.data.payload;
  const update: Record<string, string | number> = {};
  for (const field of STRING_FIELDS) {
    const value = payload[field];
    if (typeof value === "string" && value.length <= 500) update[field] = value;
  }
  if (typeof payload.borderRadius === "number" && Number.isFinite(payload.borderRadius) && payload.borderRadius >= 0 && payload.borderRadius <= 64) {
    update.borderRadius = payload.borderRadius;
  }
  if (payload.mode === "light" || payload.mode === "dark") update.mode = payload.mode;
  if (payload.density === "compact" || payload.density === "comfortable") update.density = payload.density;

  return Object.keys(update).length > 0 ? update as ThemePreviewUpdate : null;
}
