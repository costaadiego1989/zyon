import { Inject, Injectable } from "@nestjs/common";
import type { DashboardOverview, MerchantRules } from "@aacp/shared-types";
import {
  CHECKOUT_REPOSITORY,
  type CheckoutRepository
} from "../../domain/ports/checkout-repository.port.js";

@Injectable()
export class GetDashboardOverviewUseCase {
  constructor(@Inject(CHECKOUT_REPOSITORY) private readonly repository: CheckoutRepository) {}

  async execute(merchantId: string): Promise<DashboardOverview> {
    return this.repository.overview(merchantId);
  }
}

@Injectable()
export class GetMerchantRulesUseCase {
  constructor(@Inject(CHECKOUT_REPOSITORY) private readonly repository: CheckoutRepository) {}

  async execute(merchantId: string): Promise<MerchantRules> {
    return this.repository.getRules(merchantId);
  }
}

@Injectable()
export class UpdateMerchantRulesUseCase {
  constructor(@Inject(CHECKOUT_REPOSITORY) private readonly repository: CheckoutRepository) {}

  async execute(merchantId: string, rules: Partial<MerchantRules>): Promise<MerchantRules> {
    return this.repository.setRules(merchantId, rules);
  }
}
