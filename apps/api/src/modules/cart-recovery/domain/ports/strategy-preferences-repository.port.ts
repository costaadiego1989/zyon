import type { StrategyPreferences } from "../values/recovery-strategy.js";

export const STRATEGY_PREFERENCES_REPOSITORY = Symbol("STRATEGY_PREFERENCES_REPOSITORY");

export interface StrategyPreferencesRepositoryPort {
  get(merchantId: string): Promise<StrategyPreferences>;
  save(merchantId: string, strategies: StrategyPreferences): Promise<StrategyPreferences>;
}
