import { Inject, Injectable } from "@nestjs/common";
import type { DashboardOverview, MerchantRules } from "@aacp/shared-types";
import { DASHBOARD_READ_MODEL, type DashboardReadModel } from "../../domain/ports/dashboard-read-model.port.js";
import { MERCHANT_RULES_REPOSITORY, type MerchantRulesRepository } from "../../../merchant/domain/ports/merchant-rules.repository.port.js";

@Injectable()
export class GetDashboardOverviewUseCase {
  constructor(@Inject(DASHBOARD_READ_MODEL) private readonly readModel: DashboardReadModel) {}

  async execute(merchantId: string): Promise<DashboardOverview> {
    return this.readModel.overview(merchantId);
  }
}

@Injectable()
export class GetMerchantRulesUseCase {
  constructor(@Inject(MERCHANT_RULES_REPOSITORY) private readonly rulesRepo: MerchantRulesRepository) {}

  async execute(merchantId: string): Promise<MerchantRules> {
    return this.rulesRepo.getRules(merchantId);
  }
}

@Injectable()
export class UpdateMerchantRulesUseCase {
  constructor(@Inject(MERCHANT_RULES_REPOSITORY) private readonly rulesRepo: MerchantRulesRepository) {}

  async execute(merchantId: string, rules: Partial<MerchantRules>): Promise<MerchantRules> {
    return this.rulesRepo.updateRules(merchantId, rules);
  }
}
