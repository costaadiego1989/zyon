import { BadRequestException, Inject, Injectable } from "@nestjs/common";
import type { MerchantTheme } from "@aacp/shared-types";
import {
  MERCHANT_REPOSITORY,
  type MerchantRepository
} from "../domain/ports/merchant-repository.port.js";

const HEX_COLOR = /^#([0-9a-fA-F]{6})$/;
const HTTPS_URL = /^https:\/\/[\w.-]+/;

@Injectable()
export class UpdateMerchantThemeUseCase {
  constructor(@Inject(MERCHANT_REPOSITORY) private readonly repo: MerchantRepository) {}

  async execute(merchantId: string, theme: MerchantTheme): Promise<MerchantTheme> {
    const colorFields: Array<keyof MerchantTheme> = ["accentColor", "textColor", "backgroundColor"];
    for (const field of colorFields) {
      const value = theme[field];
      if (typeof value !== "string" || !HEX_COLOR.test(value)) {
        throw new BadRequestException(`invalid_color:${String(field)}`);
      }
    }
    if (typeof theme.fontFamily !== "string" || theme.fontFamily.length < 2 || theme.fontFamily.length > 200) {
      throw new BadRequestException("invalid_font_family");
    }
    if (theme.logoUrl !== undefined && theme.logoUrl !== "" && !HTTPS_URL.test(theme.logoUrl)) {
      throw new BadRequestException("invalid_logo_url");
    }
    if (theme.agentAvatarUrl !== undefined && theme.agentAvatarUrl !== "" && !HTTPS_URL.test(theme.agentAvatarUrl)) {
      throw new BadRequestException("invalid_agent_avatar_url");
    }
    return this.repo.updateTheme(merchantId, theme);
  }
}
