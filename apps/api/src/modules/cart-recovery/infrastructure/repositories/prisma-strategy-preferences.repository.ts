import type { PrismaClient } from "@prisma/client";
import type {
  StrategyPreferencesRepositoryPort,
} from "../../domain/ports/strategy-preferences-repository.port.js";
import {
  type StrategyPreferences,
  defaultStrategyPreferences,
  normalizeStrategyPreferences,
} from "../../domain/values/recovery-strategy.js";

/**
 * Prisma-backed strategy preferences repo. One row per merchant, upserted on save.
 * `strategies` is a JSON blob; readers normalize to a typed record with defaults.
 */
export class PrismaStrategyPreferencesRepository implements StrategyPreferencesRepositoryPort {
  constructor(private readonly prisma: PrismaClient) {}

  async get(merchantId: string): Promise<StrategyPreferences> {
    const row = await this.prisma.cartRecoveryStrategyPref.findUnique({
      where: { merchantId },
    });
    if (!row) return defaultStrategyPreferences();
    return normalizeStrategyPreferences(row.strategies as Record<string, unknown>);
  }

  async save(merchantId: string, strategies: StrategyPreferences): Promise<StrategyPreferences> {
    const normalized = normalizeStrategyPreferences(strategies as unknown as Record<string, unknown>);
    await this.prisma.cartRecoveryStrategyPref.upsert({
      where: { merchantId },
      create: { merchantId, strategies: normalized },
      update: { strategies: normalized },
    });
    return normalized;
  }
}