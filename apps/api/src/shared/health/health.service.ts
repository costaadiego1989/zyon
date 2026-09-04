import { Inject, Injectable, Logger, Optional } from "@nestjs/common";
import { PrismaClient } from "@prisma/client";
import { PRISMA_CLIENT } from "../persistence/persistence.module.js";
import { REDIS_CLIENT_TOKEN } from "../cache/redis.module.js";

export interface HealthCheckResult {
  status: "ok" | "degraded";
  db: boolean;
  redis: boolean | "not_configured";
  uptime: number;
  timestamp: string;
}

@Injectable()
export class HealthService {
  private readonly logger = new Logger(HealthService.name);

  constructor(
    @Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient,
    @Optional() @Inject(REDIS_CLIENT_TOKEN) private readonly redis: any
  ) {}

  async check(): Promise<HealthCheckResult> {
    const [dbOk, redisStatus] = await Promise.all([
      this.checkDb(),
      this.checkRedis(),
    ]);

    const status = dbOk ? "ok" : "degraded";

    return {
      status,
      db: dbOk,
      redis: redisStatus,
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
    };
  }

  private async checkDb(): Promise<boolean> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return true;
    } catch {
      return false;
    }
  }

  private async checkRedis(): Promise<boolean | "not_configured"> {
    if (!this.redis) return "not_configured";

    try {
      await this.redis.ping();
      return true;
    } catch (err) {
      this.logger.warn(`Redis health check failed: ${(err as Error).message}`);
      return false;
    }
  }
}