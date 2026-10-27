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
        active_strategy: "personalized_cross_sell",
        coupon_code: undefined,
        rule_id: undefined,
      };
    }
    const cfg = row.config as Record<string, unknown>;
    const couponCode = typeof cfg.coupon_code === "string" && cfg.coupon_code.trim()
      ? cfg.coupon_code.trim()
      : undefined;
    const ruleId = typeof cfg.rule_id === "string" && cfg.rule_id.trim()
      ? cfg.rule_id.trim()
      : undefined;
    const configuredStrategy = cfg.active_strategy;
    const validStrategy = configuredStrategy === "offer_free_shipping"
      || configuredStrategy === "personalized_cross_sell"
      || configuredStrategy === "offer_coupon"
      || configuredStrategy === "advanced_rule";

    // Legacy preference rows can name a coupon without a code, an advanced
    // rule without its rule id, or a now-removed strategy. None can produce a
    // valid message, so fall back to the safe, no-discount reminder. Any
    // complete, supported merchant configuration remains untouched.
    const activeStrategy = !validStrategy
      || (configuredStrategy === "offer_coupon" && !couponCode)
      || (configuredStrategy === "advanced_rule" && !ruleId)
      ? "personalized_cross_sell"
      : configuredStrategy;
    return {
      active_strategy: activeStrategy,
      coupon_code: couponCode,
      rule_id: ruleId,
    };
  }

  async saveConfig(merchantId: string, patch: Partial<StrategyConfig>): Promise<StrategyConfig> {
    const defined = Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== undefined));
    for (let retry = 0; ; retry++) {
      try {
        return await this.prisma.$transaction(async tx => {
          const row = await tx.cartRecoveryStrategyPref.findUnique({ where: { merchantId } });
          const cfg = {
            active_strategy: "personalized_cross_sell",
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
