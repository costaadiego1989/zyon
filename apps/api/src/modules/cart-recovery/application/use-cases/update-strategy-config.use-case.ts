import type { StrategyPreferencesRepositoryPort } from "../../domain/ports/strategy-preferences-repository.port.js";
import type { StrategyConfig } from "../../domain/values/recovery-strategy.js";

export interface UpdateStrategyConfigInput {
  merchantId: string;
  active_strategy: "offer_free_shipping" | "personalized_cross_sell" | "offer_coupon" | "advanced_rule";
  coupon_code?: string;
  rule_id?: string;
}

export class UpdateStrategyConfigUseCase {
  constructor(private readonly repository: StrategyPreferencesRepositoryPort) {}

  async execute(input: UpdateStrategyConfigInput): Promise<StrategyConfig> {
    const config: StrategyConfig = {
      active_strategy: input.active_strategy,
      coupon_code: input.coupon_code,
      rule_id: input.rule_id,
    };
    return this.repository.saveConfig(input.merchantId, config);
  }
}
