import { Inject, Injectable } from "@nestjs/common";
import { DEFAULT_MERCHANT_THEME, type MerchantTheme } from "@aacp/shared-types";
import {
  MERCHANT_REPOSITORY,
  type MerchantRepository
} from "../domain/ports/merchant-repository.port.js";

@Injectable()
export class GetMerchantThemeUseCase {
  constructor(@Inject(MERCHANT_REPOSITORY) private readonly repo: MerchantRepository) {}

  async execute(merchantId: string): Promise<MerchantTheme> {
    const profile = await this.repo.getProfile(merchantId);
    return {
      ...DEFAULT_MERCHANT_THEME,
      ...(profile?.theme ?? {})
    };
  }
}
