import { Inject, Injectable } from "@nestjs/common";
import { DEFAULT_MERCHANT_THEME, type MerchantTheme } from "@zyon/shared-types";
import {
  MERCHANT_REPOSITORY,
  type MerchantRepository
} from "../domain/ports/merchant-repository.port.js";
import { validateMerchantTheme } from "../domain/services/merchant-theme.validators.js";

/**
 * MERC-H1: Validation extracted to domain/services/merchant-theme.validators.ts.
 * Use-case orchestrates only: merge defaults → validate → persist.
 */
@Injectable()
export class UpdateMerchantThemeUseCase {
  constructor(@Inject(MERCHANT_REPOSITORY) private readonly repo: MerchantRepository) {}

  async execute(merchantId: string, theme: MerchantTheme): Promise<MerchantTheme> {
    const next: MerchantTheme = {
      ...DEFAULT_MERCHANT_THEME,
      ...(theme ?? {})
    };

    validateMerchantTheme(next);

    return this.repo.updateTheme(merchantId, next);
  }
}
