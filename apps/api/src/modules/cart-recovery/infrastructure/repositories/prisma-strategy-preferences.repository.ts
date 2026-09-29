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
    const couponCode = (cfg.coupon_code as string | undefined) ?? undefined;
    const rawStrategies = (row.strategies as Record<string, unknown> | null) ?? {};
    const hasExplicitStrategySelection = Object.values(rawStrategies).some((value) => value === true);
    const hasSelectedDefaultReminder = rawStrategies.personalized_cross_sell === true;

    // The original database default created an incomplete coupon strategy.
    // There is no coupon to send in that state, so the scanner safely pauses
    // every recovery. Treat only that legacy, unselected default as the same
    // dispatchable reminder used for merchants with no saved preference. Some
    // legacy rows also persisted that reminder as selected while leaving the
    // obsolete coupon config in place; that mismatch is safe to normalize too.
    // An explicit coupon selection remains paused until its code is configured.
    const activeStrategy = cfg.active_strategy === "offer_coupon"
      && !couponCode
      && (!hasExplicitStrategySelection || hasSelectedDefaultReminder)
      ? "personalized_cross_sell"
      : (cfg.active_strategy as StrategyConfig["active_strategy"] | undefined) ?? "personalized_cross_sell";
    return {
      active_strategy: activeStrategy,
      coupon_code: couponCode,
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
