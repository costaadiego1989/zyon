import type {
  StrategyPreferencesRepositoryPort,
} from "../../domain/ports/strategy-preferences-repository.port.js";
import type { StrategyPreferences, StrategyConfig } from "../../domain/values/recovery-strategy.js";
import { defaultStrategyPreferences, normalizeStrategyPreferences } from "../../domain/values/recovery-strategy.js";

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
    const normalized = normalizeStrategyPreferences(strategies);
    const active = Object.keys(normalized).find(key => normalized[key as keyof StrategyPreferences]) as StrategyConfig["active_strategy"];
    await this.saveConfig(merchantId, { active_strategy: active });
    return { ...normalized };
  }

  async getConfig(merchantId: string): Promise<StrategyConfig> {
    return this.config.get(merchantId) ?? {
      active_strategy: "offer_coupon",
      coupon_code: undefined,
      rule_id: undefined,
    };
  }

  async saveConfig(merchantId: string, patch: Partial<StrategyConfig>): Promise<StrategyConfig> {
    const defined = Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== undefined));
    const cfg = { ...await this.getConfig(merchantId), ...defined };
    this.config.set(merchantId, { ...cfg });
    this.prefs.set(merchantId, normalizeStrategyPreferences({ [cfg.active_strategy]: true }));
    return { ...cfg };
  }
}
