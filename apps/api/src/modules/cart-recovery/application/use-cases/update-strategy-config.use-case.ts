import { BadRequestException } from "@nestjs/common";
import type { StrategyPreferencesRepositoryPort } from "../../domain/ports/strategy-preferences-repository.port.js";
import { TOGGLEABLE_STRATEGY_KEYS, type StrategyConfig } from "../../domain/values/recovery-strategy.js";

export interface UpdateStrategyConfigInput extends Partial<StrategyConfig> {
  merchantId: string;
}

export class UpdateStrategyConfigUseCase {
  constructor(private readonly repository: StrategyPreferencesRepositoryPort) {}

  async execute(input: UpdateStrategyConfigInput): Promise<StrategyConfig> {
    const patch: Partial<StrategyConfig> = {};
    if (input.active_strategy !== undefined) {
      if (!TOGGLEABLE_STRATEGY_KEYS.includes(input.active_strategy)) {
        throw new BadRequestException("Estratégia de recuperação inválida.");
      }
      patch.active_strategy = input.active_strategy;
    }
    for (const key of ["coupon_code", "rule_id"] as const) {
      if (input[key] === undefined) continue;
      if (typeof input[key] !== "string" || input[key].length > 200) {
        throw new BadRequestException("Vínculo de recuperação inválido.");
      }
      patch[key] = input[key].trim();
    }
    return this.repository.saveConfig(input.merchantId, patch);
  }
}
