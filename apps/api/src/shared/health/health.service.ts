import { Inject, Injectable, Logger } from "@nestjs/common";
import { PrismaClient } from "@prisma/client";
import { PRISMA_CLIENT } from "../persistence/persistence.module.js";

export type ReadinessResult =
  | { ready: true; db: "connected"; redis: "connected" | "not_configured" }
  | { ready: false; db: "connected" | "disconnected"; redis: "connected" | "disconnected" | "not_configured" };

@Injectable()
export class HealthService {
  private readonly logger = new Logger(HealthService.name);

  constructor(
    @Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient
  ) {}

  liveness(): { status: "ok"; timestamp: string } {
    return { status: "ok", timestamp: new Date().toISOString() };
  }

  async readiness(): Promise<ReadinessResult> {
    const [dbOk, redisStatus] = await Promise.all([
      this.checkDb(),
      this.checkRedis(),
    ]);

    const ready = dbOk && (redisStatus === "connected" || redisStatus === "not_configured");
    return {
      ready,
      db: dbOk ? "connected" : "disconnected",
      redis: redisStatus,
    } as ReadinessResult;
  }

  private async checkDb(): Promise<boolean> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return true;
    } catch {
      return false;
    }
  }

  private async checkRedis(): Promise<"connected" | "disconnected" | "not_configured"> {
    const redisUrl = process.env.REDIS_URL?.trim();
    if (!redisUrl) return "not_configured";

    const { Redis } = await import("ioredis");
    const client = new Redis(redisUrl, {
      connectTimeout: 2000,
      commandTimeout: 2000,
      maxRetriesPerRequest: 0,
      lazyConnect: true,
      retryStrategy: () => null,
    });
    // The catch below reports failures; always close this short-lived probe.
    client.on("error", () => undefined);
    try {
      await client.connect();
      await client.ping();
      return "connected";
    } catch (err) {
      this.logger.warn(`Redis health check failed: ${(err as Error).message}`);
      return "disconnected";
    } finally {
      client.disconnect();
    }
  }
}
