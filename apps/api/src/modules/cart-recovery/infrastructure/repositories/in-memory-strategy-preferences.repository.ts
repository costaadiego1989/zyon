import type {
  StrategyPreferencesRepositoryPort,
} from "../../domain/ports/strategy-preferences-repository.port.js";
import type { StrategyPreferences, StrategyConfig } from "../../domain/values/recovery-strategy.js";
import { defaultStrategyPreferences } from "../../domain/values/recovery-strategy.js";

/**
 * In-memory strategy preferences + config repo. Used as test double only.
 * Production path uses PrismaStrategyPreferencesRepository (CartRecoveryModule).
 */
export class InMemoryStrategyPreferencesRepository implements StrategyPreferencesRepositoryPort {
  private readonly prefs = new Map<string, StrategyPreferences>();
  private readonly config = new Map<string, StrategyConfig>();

  async get(merchantId: string): Promise<StrategyPreferences> {
    return this.prefs.get(merchantId) ?? defaultStrategyPreferences();
  }

  async save(merchantId: string, strategies: StrategyPreferences): Promise<StrategyPreferences> {
    this.prefs.set(merchantId, { ...strategies });
    return { ...strategies };
  }

  async getConfig(merchantId: string): Promise<StrategyConfig> {
    return this.config.get(merchantId) ?? {
      active_strategy: "offer_coupon",
      coupon_code: undefined,
      rule_id: undefined,
    };
  }

  async saveConfig(merchantId: string, cfg: StrategyConfig): Promise<StrategyConfig> {
    this.config.set(merchantId, { ...cfg });
    return { ...cfg };
  }
}
