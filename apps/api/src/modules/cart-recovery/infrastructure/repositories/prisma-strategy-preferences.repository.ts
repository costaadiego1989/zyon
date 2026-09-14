import type { PrismaClient, Prisma } from "@prisma/client";
import type {
  StrategyPreferencesRepositoryPort,
} from "../../domain/ports/strategy-preferences-repository.port.js";
import {
  type StrategyPreferences,
  type StrategyConfig,
  defaultStrategyPreferences,
  normalizeStrategyPreferences,
} from "../../domain/values/recovery-strategy.js";

/**
 * Prisma-backed strategy preferences + config repo. One row per merchant, upserted on save.
 * `strategies` and `config` are JSON blobs; readers normalize to typed records with defaults.
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
    const active = Object.keys(normalized).find(key => normalized[key as keyof StrategyPreferences]) as StrategyConfig["active_strategy"];
    await this.saveConfig(merchantId, { active_strategy: active });
    return normalized;
  }

  async getConfig(merchantId: string): Promise<StrategyConfig> {
    const row = await this.prisma.cartRecoveryStrategyPref.findUnique({
      where: { merchantId },
    });
    if (!row || !row.config) {
      return {
        active_strategy: "offer_coupon",
        coupon_code: undefined,
        rule_id: undefined,
      };
    }
    const cfg = row.config as Record<string, unknown>;
    return {
      active_strategy: (cfg.active_strategy as any) ?? "offer_coupon",
      coupon_code: (cfg.coupon_code as string | undefined) ?? undefined,
      rule_id: (cfg.rule_id as string | undefined) ?? undefined,
    };
  }

  async saveConfig(merchantId: string, patch: Partial<StrategyConfig>): Promise<StrategyConfig> {
    const defined = Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== undefined));
    for (let retry = 0; ; retry++) {
      try {
        return await this.prisma.$transaction(async tx => {
          const row = await tx.cartRecoveryStrategyPref.findUnique({ where: { merchantId } });
          const cfg = {
            active_strategy: "offer_coupon",
            ...((row?.config as Record<string, unknown> | null) ?? {}),
            ...defined,
          } as StrategyConfig;
          const strategies = normalizeStrategyPreferences({ [cfg.active_strategy]: true });
          const config = cfg as unknown as Prisma.InputJsonValue;
          await tx.cartRecoveryStrategyPref.upsert({
            where: { merchantId },
            create: { merchantId, config, strategies },
            update: { config, strategies },
          });
          return cfg;
        }, { isolationLevel: "Serializable" });
      } catch (error) {
        const code = (error as { code?: string }).code;
        if (retry >= 2 || (code !== "P2034" && code !== "P2002")) throw error;
      }
    }
  }
}
