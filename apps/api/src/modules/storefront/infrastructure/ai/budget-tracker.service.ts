import { Injectable, Inject, Logger } from "@nestjs/common";

export const REDIS_CLIENT_TOKEN = "REDIS_CLIENT";

type RedisClient = any; // ioredis v5 ESM compatibility

export enum MerchantPlan {
  STORE_ONLY = "STORE_ONLY",
  BOTH = "BOTH",
  API = "API"
}

const PLAN_LIMITS: Record<MerchantPlan, number> = {
  [MerchantPlan.STORE_ONLY]: 2000,
  [MerchantPlan.BOTH]: 5000,
  [MerchantPlan.API]: 10000
};

@Injectable()
export class BudgetTrackerService {
  private readonly logger = new Logger(BudgetTrackerService.name);

  constructor(@Inject(REDIS_CLIENT_TOKEN) private readonly redis: RedisClient | null) {}

  private getCurrentMonth(): string {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, "0");
    return `${year}-${month}`;
  }

  private buildKey(merchantId: string, month: string): string {
    return `budget:${merchantId}:${month}`;
  }

  async increment(merchantId: string, delta: number = 1): Promise<number> {
    if (!this.redis) {
      this.logger.warn("Redis unavailable; budget tracking skipped");
      return 0;
    }

    try {
      const month = this.getCurrentMonth();
      const key = this.buildKey(merchantId, month);
      const newCount = await this.redis.incrby(key, delta);

      if (newCount === delta) {
        await this.redis.expire(key, 31 * 24 * 60 * 60);
      }

      return newCount;
    } catch (error) {
      this.logger.error(`Failed to increment budget for ${merchantId}: ${(error as Error).message}`);
      return 0;
    }
  }

  async getUsage(merchantId: string): Promise<number> {
    if (!this.redis) return 0;

    try {
      const month = this.getCurrentMonth();
      const key = this.buildKey(merchantId, month);
      const count = await this.redis.get(key);
      return parseInt(count ?? "0", 10);
    } catch (error) {
      this.logger.error(`Failed to get usage for ${merchantId}: ${(error as Error).message}`);
      return 0;
    }
  }

  async isOverBudget(merchantId: string, plan: MerchantPlan): Promise<boolean> {
    const usage = await this.getUsage(merchantId);
    const limit = PLAN_LIMITS[plan];
    return usage >= limit;
  }

  async getRemaining(merchantId: string, plan: MerchantPlan): Promise<number> {
    const usage = await this.getUsage(merchantId);
    const limit = PLAN_LIMITS[plan];
    return Math.max(0, limit - usage);
  }

  async getStats(merchantId: string, plan: MerchantPlan) {
    const usage = await this.getUsage(merchantId);
    const limit = PLAN_LIMITS[plan];
    const remaining = Math.max(0, limit - usage);
    const percentage = limit > 0 ? Math.round((usage / limit) * 100) : 0;

    return {
      usage,
      limit,
      remaining,
      percentage,
      month: this.getCurrentMonth()
    };
  }

  async reset(merchantId: string): Promise<void> {
    if (!this.redis) return;

    try {
      const month = this.getCurrentMonth();
      const key = this.buildKey(merchantId, month);
      await this.redis.del(key);
      this.logger.log(`Budget reset for merchant ${merchantId}`);
    } catch (error) {
      this.logger.error(`Failed to reset budget for ${merchantId}: ${(error as Error).message}`);
    }
  }
}
