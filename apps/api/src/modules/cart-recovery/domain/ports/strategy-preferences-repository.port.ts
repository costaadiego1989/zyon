import type { StrategyPreferences, StrategyConfig } from "../values/recovery-strategy.js";

export const STRATEGY_PREFERENCES_REPOSITORY = Symbol("STRATEGY_PREFERENCES_REPOSITORY");

export interface StrategyPreferencesRepositoryPort {
  get(merchantId: string): Promise<StrategyPreferences>;
  save(merchantId: string, strategies: StrategyPreferences): Promise<StrategyPreferences>;
  getConfig(merchantId: string): Promise<StrategyConfig>;
  saveConfig(merchantId: string, config: StrategyConfig): Promise<StrategyConfig>;
}

