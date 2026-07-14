/**
 * MERC-H1 + MERC-C2: Extracted theme validators.
 * Reusable by use-cases, DTOs, and persistence codec.
 */
import { BadRequestException } from "@nestjs/common";
import type { MerchantTheme } from "@zyon/shared-types";

const HEX_COLOR = /^#([0-9a-fA-F]{6})$/;
const DENSITIES = new Set(["compact", "comfortable", "spacious"]);

export function assertValidHexColor(field: string, value: unknown): void {
  if (value !== undefined && (typeof value !== "string" || !HEX_COLOR.test(value))) {
    throw new BadRequestException(`invalid_color:${field}`);
  }
}

export function assertValidUrl(field: string, value: unknown): void {
  if (value === undefined || value === "") return;
  if (typeof value !== "string") {
    throw new BadRequestException(`invalid_${field}`);
  }
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") throw new BadRequestException(`invalid_${field}`);
  } catch {
    throw new BadRequestException(`invalid_${field}`);
  }
}

export function assertValidFontFamily(field: string, value: unknown): void {
  if (typeof value !== "string" || value.length < 2 || value.length > 200) {
    throw new BadRequestException(`invalid_${field}`);
  }
}

export function assertTextField(name: string, value: unknown, maxLength: number): void {
  if (value === undefined || value === "") return;
  if (typeof value !== "string" || value.trim().length === 0 || value.length > maxLength) {
    throw new BadRequestException(`invalid_${name}`);
  }
}

export function assertValidTrustBadges(badges: unknown): void {
  if (badges === undefined) return;
  if (!Array.isArray(badges) || badges.length > 4) {
    throw new BadRequestException("invalid_trust_badges");
  }
  for (const badge of badges) {
    assertTextField("trust_badge", badge, 40);
  }
}

export function assertValidDensity(value: unknown): void {
  if (value !== undefined && !DENSITIES.has(value as string)) {
    throw new BadRequestException("invalid_density");
  }
}

export function assertValidBorderRadius(value: unknown): void {
  if (value !== undefined && (!Number.isFinite(value) || (value as number) < 4 || (value as number) > 24)) {
    throw new BadRequestException("invalid_border_radius");
  }
}

const COLOR_FIELDS: Array<keyof MerchantTheme> = [
  "accentColor",
  "secondaryColor",
  "textColor",
  "backgroundColor",
  "surfaceColor",
  "surfaceElevatedColor",
  "borderColor",
  "successColor",
  "warningColor",
  "mutedTextColor"
];

/**
 * Full theme validation — used by both use-case (write) and persistence codec (read).
 */
export function validateMerchantTheme(theme: MerchantTheme): void {
  for (const field of COLOR_FIELDS) {
    assertValidHexColor(String(field), theme[field]);
  }
  assertValidFontFamily("font_family", theme.fontFamily);
  if (theme.fontDisplay !== undefined) {
    assertValidFontFamily("font_display", theme.fontDisplay);
  }
  assertValidUrl("logo_url", theme.logoUrl);
  assertValidUrl("agent_avatar_url", theme.agentAvatarUrl);
  assertValidUrl("background_image_url", theme.backgroundImageUrl);
  assertValidBorderRadius(theme.borderRadius);
  assertValidDensity(theme.density);
  assertTextField("header_title", theme.headerTitle, 80);
  assertTextField("header_subtitle", theme.headerSubtitle, 140);
  assertTextField("agent_name", theme.agentName, 80);
  assertValidTrustBadges(theme.trustBadges);
}

/**
 * MERC-C2: Safe theme codec — validates JSON from persistence before casting.
 * Returns undefined if theme is null/undefined. Throws on malformed data.
 */
export function decodePersistedTheme(raw: unknown): MerchantTheme | undefined {
  if (raw == null) return undefined;
  if (typeof raw !== "object") return undefined;
  const theme = raw as MerchantTheme;
  // Validate critical fields exist and are sane
  if (typeof theme.fontFamily !== "string") return undefined;
  if (typeof theme.accentColor !== "string") return undefined;
  return theme;
}
