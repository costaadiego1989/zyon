import type {
  StrategyPreferencesRepositoryPort,
} from "../../domain/ports/strategy-preferences-repository.port.js";
import type { StrategyPreferences } from "../../domain/values/recovery-strategy.js";
import { defaultStrategyPreferences } from "../../domain/values/recovery-strategy.js";

/**
 * In-memory strategy preferences repo. Used as test double only.
 * Production path uses PrismaStrategyPreferencesRepository (CartRecoveryModule).
 */
export class InMemoryStrategyPreferencesRepository implements StrategyPreferencesRepositoryPort {
  private readonly store = new Map<string, StrategyPreferences>();

  async get(merchantId: string): Promise<StrategyPreferences> {
    return this.store.get(merchantId) ?? defaultStrategyPreferences();
  }

  async save(merchantId: string, strategies: StrategyPreferences): Promise<StrategyPreferences> {
    this.store.set(merchantId, { ...strategies });
    return { ...strategies };
  }
}