import type { StrategyPreferencesRepositoryPort } from "../../domain/ports/strategy-preferences-repository.port.js";
import type { StrategyPreferences } from "../../domain/values/recovery-strategy.js";

export interface UpdateStrategyPreferencesInput {
  merchantId: string;
  strategies: Partial<Record<keyof StrategyPreferences, boolean>>;
}

export class UpdateStrategyPreferencesUseCase {
  constructor(private readonly repository: StrategyPreferencesRepositoryPort) {}

  async execute(input: UpdateStrategyPreferencesInput): Promise<StrategyPreferences> {
    const current = await this.repository.get(input.merchantId);
    const merged: StrategyPreferences = { ...current };
    for (const [key, value] of Object.entries(input.strategies)) {
      if (typeof value === "boolean" && key in current) {
        (merged as Record<string, boolean>)[key] = value;
      }
    }
    return this.repository.save(input.merchantId, merged);
  }
}