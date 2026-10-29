import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import type { PrismaClient } from "@prisma/client";
import { PRISMA_CLIENT } from "../persistence/persistence.module.js";

const RETENTION_INTERVAL_MS = 6 * 60 * 60 * 1_000;
const DAYS = (days: number): number => days * 24 * 60 * 60 * 1_000;

@Injectable()
export class DataRetentionService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DataRetentionService.name);
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;

  constructor(@Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient) {}

  onModuleInit(): void {
    if (process.env.DATA_RETENTION_ENABLED !== "true") {
      this.logger.log("Disabled. Set DATA_RETENTION_ENABLED=true to enable.");
      return;
    }

    this.logger.log("Enabled. Running every 6h.");
    void this.run();
    this.timer = setInterval(() => void this.run(), RETENTION_INTERVAL_MS);
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async run(): Promise<void> {
    if (this.running) return;

    this.running = true;
    try {
      const now = new Date();
      await this.purgeExpiredOtps(now);
      await this.purgeExpiredIdempotency(now);
      await this.purgeExpiredShippingQuotes(now);
      await this.purgeOldCheckoutSessions(now);
      await this.purgeOldWebhookDeliveries(now);
    } catch (error) {
      this.logger.error("retention.run.failed", { error: error instanceof Error ? error.message : String(error) });
    } finally {
      this.running = false;
    }
  }

  private async purgeExpiredOtps(now: Date): Promise<void> {
    const result = await this.prisma.buyerPhoneOtp.deleteMany({
      where: { expiresAt: { lt: now } },
    });
    if (result.count > 0) this.logger.log("purged.otps", { count: result.count });
  }

  private async purgeExpiredIdempotency(now: Date): Promise<void> {
    const result = await this.prisma.httpIdempotencyRecord.deleteMany({
      where: { expiresAt: { lt: now } },
    });
    if (result.count > 0) this.logger.log("purged.idempotency", { count: result.count });
  }

  private async purgeExpiredShippingQuotes(now: Date): Promise<void> {
    const cutoff = new Date(now.getTime() - DAYS(7));
    try {
      const result = await this.prisma.shippingQuote.deleteMany({
        where: { createdAt: { lt: cutoff } },
      });
      if (result.count > 0) this.logger.log("purged.shippingQuotes", { count: result.count });
    } catch {
      // table may not exist
    }
  }

  private async purgeOldCheckoutSessions(now: Date): Promise<void> {
    const cutoff = new Date(now.getTime() - DAYS(90));
    try {
      const deleteMany = this.prisma.checkoutSession.deleteMany as (args: unknown) => Promise<{ count: number }>;
      const result = await deleteMany({
        where: { createdAt: { lt: cutoff }, status: { not: "completed" } },
      });
      if (result.count > 0) this.logger.log("purged.checkoutSessions", { count: result.count });
    } catch {
      // table may not exist or no status column
    }
  }

  private async purgeOldWebhookDeliveries(now: Date): Promise<void> {
    const cutoff = new Date(now.getTime() - DAYS(90));
    try {
      const result = await this.prisma.merchantWebhookDelivery.deleteMany({
        where: {
          createdAt: { lt: cutoff },
          status: { in: ["delivered", "failed"] },
        },
      });
      if (result.count > 0) this.logger.log("purged.webhookDeliveries", { count: result.count });
    } catch {
      // table may not exist
    }
  }
}
