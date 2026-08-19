import { Injectable } from "@nestjs/common";
import { MARKETPLACE_CONFIG_REPOSITORY } from "../../domain/ports/marketplace-config-repository.port.js";
import type {
  MarketplaceConfigRepository,
  MarketplaceConfigSnapshot,
  UpsertMarketplaceConfigInput,
} from "../../domain/ports/marketplace-config-repository.port.js";

export interface UpdateMarketplaceConfigInput {
  merchantId: string;
  enabled?: boolean;
  commissionRateBps?: number;
  returnWindowDays?: number;
  payoutDelayDays?: number;
  chargebackWindowDays?: number;
  allowedCategories?: string[];
  blockedMerchants?: string[];
}

export interface UpdateMarketplaceConfigOutput {
  config: MarketplaceConfigSnapshot;
}

@Injectable()
export class UpdateMarketplaceConfigUseCase {
  constructor(
    private readonly configRepository: MarketplaceConfigRepository,
  ) {}

  async execute(
    input: UpdateMarketplaceConfigInput,
  ): Promise<UpdateMarketplaceConfigOutput> {
    this.validateInput(input);

    const config = await this.configRepository.upsert({
      merchantId: input.merchantId,
      enabled: input.enabled,
      commissionRateBps: input.commissionRateBps,
      returnWindowDays: input.returnWindowDays,
      payoutDelayDays: input.payoutDelayDays,
      chargebackWindowDays: input.chargebackWindowDays,
      allowedCategories: input.allowedCategories,
      blockedMerchants: input.blockedMerchants,
    });

    return { config };
  }

  private validateInput(input: UpdateMarketplaceConfigInput): void {
    if (
      input.commissionRateBps !== undefined &&
      (input.commissionRateBps < 100 || input.commissionRateBps > 5000)
    ) {
      throw new Error(
        "commission_rate_bps must be between 100 and 5000 (1%-50%)",
      );
    }

    if (
      input.returnWindowDays !== undefined &&
      (input.returnWindowDays < 1 || input.returnWindowDays > 30)
    ) {
      throw new Error("return_window_days must be between 1 and 30");
    }

    if (
      input.payoutDelayDays !== undefined &&
      (input.payoutDelayDays < 1 || input.payoutDelayDays > 30)
    ) {
      throw new Error("payout_delay_days must be between 1 and 30");
    }

    if (
      input.chargebackWindowDays !== undefined &&
      (input.chargebackWindowDays < 7 || input.chargebackWindowDays > 30)
    ) {
      throw new Error("chargeback_window_days must be between 7 and 30");
    }
  }
}
