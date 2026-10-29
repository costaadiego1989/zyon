import type { StrategyPreferencesRepositoryPort } from "../../domain/ports/strategy-preferences-repository.port.js";
import type { StrategyPreferences } from "../../domain/values/recovery-strategy.js";

export interface GetStrategyPreferencesInput {
  merchantId: string;
}

export class GetStrategyPreferencesUseCase {
  constructor(private readonly repository: StrategyPreferencesRepositoryPort) {}

  async execute(input: GetStrategyPreferencesInput): Promise<StrategyPreferences> {
    return this.repository.get(input.merchantId);
  }
}