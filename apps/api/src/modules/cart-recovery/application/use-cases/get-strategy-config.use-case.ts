import type { StrategyPreferencesRepositoryPort } from "../../domain/ports/strategy-preferences-repository.port.js";
import type { StrategyConfig } from "../../domain/values/recovery-strategy.js";

export interface GetStrategyConfigInput {
  merchantId: string;
}

export class GetStrategyConfigUseCase {
  constructor(private readonly repository: StrategyPreferencesRepositoryPort) {}

  async execute(input: GetStrategyConfigInput): Promise<StrategyConfig> {
    return this.repository.getConfig(input.merchantId);
  }
}
