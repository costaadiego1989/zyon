import { BadRequestException, Inject, Injectable } from "@nestjs/common";
import { DEFAULT_MERCHANT_THEME, type MerchantTheme } from "@aacp/shared-types";
import {
  MERCHANT_REPOSITORY,
  type MerchantRepository
} from "../domain/ports/merchant-repository.port.js";

const HEX_COLOR = /^#([0-9a-fA-F]{6})$/;
const DENSITIES = new Set(["compact", "comfortable", "spacious"]);

function isHttpsUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:";
  } catch {
    return false;
  }
}

function assertTextField(name: string, value: unknown, maxLength: number) {
  if (value === undefined || value === "") return;
  if (typeof value !== "string" || value.trim().length === 0 || value.length > maxLength) {
    throw new BadRequestException(`invalid_${name}`);
  }
}

@Injectable()
export class UpdateMerchantThemeUseCase {
  constructor(@Inject(MERCHANT_REPOSITORY) private readonly repo: MerchantRepository) {}

  async execute(merchantId: string, theme: MerchantTheme): Promise<MerchantTheme> {
    const next: MerchantTheme = {
      ...DEFAULT_MERCHANT_THEME,
      ...(theme ?? {})
    };

    const colorFields: Array<keyof MerchantTheme> = [
      "accentColor",
      "textColor",
      "backgroundColor",
      "surfaceColor",
      "surfaceElevatedColor",
      "borderColor",
      "successColor",
      "warningColor",
      "mutedTextColor"
    ];
    for (const field of colorFields) {
      const value = next[field];
      if (value !== undefined && (typeof value !== "string" || !HEX_COLOR.test(value))) {
        throw new BadRequestException(`invalid_color:${String(field)}`);
      }
    }
    if (typeof next.fontFamily !== "string" || next.fontFamily.length < 2 || next.fontFamily.length > 200) {
      throw new BadRequestException("invalid_font_family");
    }
    if (next.fontDisplay !== undefined && (typeof next.fontDisplay !== "string" || next.fontDisplay.length < 2 || next.fontDisplay.length > 200)) {
      throw new BadRequestException("invalid_font_display");
    }
    if (next.logoUrl !== undefined && next.logoUrl !== "" && !isHttpsUrl(next.logoUrl)) {
      throw new BadRequestException("invalid_logo_url");
    }
    if (next.agentAvatarUrl !== undefined && next.agentAvatarUrl !== "" && !isHttpsUrl(next.agentAvatarUrl)) {
      throw new BadRequestException("invalid_agent_avatar_url");
    }
    if (next.backgroundImageUrl !== undefined && next.backgroundImageUrl !== "" && !isHttpsUrl(next.backgroundImageUrl)) {
      throw new BadRequestException("invalid_background_image_url");
    }
    if (next.borderRadius !== undefined && (!Number.isFinite(next.borderRadius) || next.borderRadius < 4 || next.borderRadius > 24)) {
      throw new BadRequestException("invalid_border_radius");
    }
    if (next.density !== undefined && !DENSITIES.has(next.density)) {
      throw new BadRequestException("invalid_density");
    }
    assertTextField("header_title", next.headerTitle, 80);
    assertTextField("header_subtitle", next.headerSubtitle, 140);
    assertTextField("agent_name", next.agentName, 80);
    if (next.trustBadges !== undefined) {
      if (!Array.isArray(next.trustBadges) || next.trustBadges.length > 4) {
        throw new BadRequestException("invalid_trust_badges");
      }
      for (const badge of next.trustBadges) {
        assertTextField("trust_badge", badge, 40);
      }
    }
    return this.repo.updateTheme(merchantId, next);
  }
}
