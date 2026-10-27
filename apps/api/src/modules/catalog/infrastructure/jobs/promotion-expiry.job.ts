import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { Queue, Worker, type Job } from "bullmq";
import type { RedisOptions } from "ioredis";
import type { PrismaClient } from "@prisma/client";
import { PRISMA_CLIENT } from "../../../../shared/persistence/persistence.module.js";

export const PROMOTION_EXPIRY_QUEUE = "catalog-promotion-expiry";
const JOB_NAME = "deactivate-expired";
const RECURRING_JOB_KEY = "catalog-promotion-expiry:cron";
const CRON_EVERY_5_MIN = "*/5 * * * *";

interface PromotionExpiryJobData {
  triggeredAt: string;
}

function redisConnection(): RedisOptions | null {
  const raw = process.env.REDIS_URL?.trim();
  if (!raw) return null;
  const url = new URL(raw);
  return {
    host: url.hostname,
    port: url.port ? Number(url.port) : 6379,
    username: url.username ? decodeURIComponent(url.username) : undefined,
    password: url.password ? decodeURIComponent(url.password) : undefined,
    db: url.pathname.length > 1 ? Number(url.pathname.slice(1)) : 0,
    maxRetriesPerRequest: null,
  };
}

@Injectable()
export class PromotionExpiryScheduler implements OnModuleDestroy {
  private readonly logger = new Logger(PromotionExpiryScheduler.name);
  private readonly queue: Queue<PromotionExpiryJobData> | null;

  constructor() {
    const connection = redisConnection();
    this.queue = connection
      ? new Queue<PromotionExpiryJobData>(PROMOTION_EXPIRY_QUEUE, { connection })
      : null;
  }

  async ensureRecurringJob(): Promise<void> {
    if (!this.queue) return;
    try {
      await this.queue.add(JOB_NAME, { triggeredAt: new Date().toISOString() }, {
        jobId: RECURRING_JOB_KEY,
        repeat: { pattern: CRON_EVERY_5_MIN },
        removeOnComplete: 100,
        removeOnFail: 1_000,
      });
      this.logger.log(`Scheduled recurring promotion expiry (cron=${CRON_EVERY_5_MIN})`);
    } catch (err) {
      this.logger.warn(
        `Failed to register recurring promotion expiry: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.queue?.close();
  }
}

@Injectable()
export class PromotionExpiryWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PromotionExpiryWorker.name);
  private worker: Worker<PromotionExpiryJobData> | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    @Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient,
    private readonly scheduler: PromotionExpiryScheduler,
  ) {}

  async onModuleInit(): Promise<void> {
    const connection = redisConnection();
    if (connection) {
      await this.scheduler.ensureRecurringJob();
      this.worker = new Worker<PromotionExpiryJobData>(
        PROMOTION_EXPIRY_QUEUE,
        (job) => this.process(job),
        { connection, concurrency: 1 },
      );
      this.worker.on("failed", (job, err) => {
        this.logger.warn(`Promotion expiry job failed ${job?.id ?? "unknown"}: ${err.message}`);
      });
    } else {
      this.timer = setInterval(() => {
        void this.expireAndLog().catch((err) => {
          this.logger.warn(`Promotion expiry timer failed: ${err instanceof Error ? err.message : String(err)}`);
        });
      }, 5 * 60 * 1_000);
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    await this.worker?.close();
  }

  private async process(job: Job<PromotionExpiryJobData>): Promise<void> {
    const counts = await this.expireAndLog();
    this.logger.log(`Promotion expiry tick ${job.id ?? "n/a"} deactivated=${counts.promos + counts.coupons}`);
  }

  async expireAndLog(): Promise<{ promos: number; coupons: number }> {
    const now = new Date();

    const promoResult = await (this.prisma as any).productPromotion.updateMany({
      where: { isActive: true, endsAt: { lt: now } },
      data: { isActive: false },
    });
    const promos = promoResult?.count ?? 0;

    const couponResult = await (this.prisma as any).coupon.updateMany({
      where: { status: "active", endsAt: { lt: now, not: null } },
      data: { status: "expired" },
    });
    const coupons = couponResult?.count ?? 0;

    if (promos > 0) this.logger.log(`Deactivated ${promos} expired promotion(s)`);
    if (coupons > 0) this.logger.log(`Expired ${coupons} coupon(s)`);

    return { promos, coupons };
  }
}
