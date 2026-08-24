import type { StrategyPreferencesRepositoryPort } from "../../domain/ports/strategy-preferences-repository.port.js";
import { normalizeStrategyPreferences, type StrategyPreferences } from "../../domain/values/recovery-strategy.js";

export interface UpdateStrategyPreferencesInput {
  merchantId: string;
  strategies: Partial<Record<keyof StrategyPreferences, boolean>>;
}

export class UpdateStrategyPreferencesUseCase {
  constructor(private readonly repository: StrategyPreferencesRepositoryPort) {}

  async execute(input: UpdateStrategyPreferencesInput): Promise<StrategyPreferences> {
    const normalized = normalizeStrategyPreferences(input.strategies as Record<string, unknown>);
    return this.repository.save(input.merchantId, normalized);
  }
}
