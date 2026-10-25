import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { Queue, Worker, type Job } from "bullmq";
import type { RedisOptions } from "ioredis";
import { StockRepositoryPort } from "../../domain/ports/product-repository.port.js";

export const CATALOG_STOCK_EXPIRY_QUEUE = "catalog-stock-expiry";
const JOB_NAME = "release-expired";
const RECURRING_JOB_KEY = "catalog-stock-expiry:cron";
const CRON_EVERY_5_MIN = "*/5 * * * *";

interface StockExpiryJobData {
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

/**
 * BullMQ queue that schedules a recurring job every 5 minutes to release
 * expired stock reservations. If Redis is not configured the queue is a
 * no-op and releaseExpired is invoked only by the in-process fallback.
 */
@Injectable()
export class CatalogStockExpiryScheduler implements OnModuleDestroy {
  private readonly logger = new Logger(CatalogStockExpiryScheduler.name);
  private readonly queue: Queue<StockExpiryJobData> | null;

  constructor() {
    const connection = redisConnection();
    this.queue = connection
      ? new Queue<StockExpiryJobData>(CATALOG_STOCK_EXPIRY_QUEUE, { connection })
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
      this.logger.log(`Scheduled recurring stock expiry (cron=${CRON_EVERY_5_MIN})`);
    } catch (err) {
      this.logger.warn(
        `Failed to register recurring stock expiry: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.queue?.close();
  }
}

/**
 * Worker that drains the queue and releases expired stock reservations.
 * Falls back to a 5-minute setInterval loop when Redis is not configured,
 * so releaseExpired keeps running in environments without BullMQ.
 */
@Injectable()
export class StockExpiryWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(StockExpiryWorker.name);
  private worker: Worker<StockExpiryJobData> | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    @Inject("StockRepositoryPort") private readonly stockRepo: StockRepositoryPort,
    private readonly scheduler: CatalogStockExpiryScheduler,
  ) {}

  async onModuleInit(): Promise<void> {
    const connection = redisConnection();
    if (connection) {
      await this.scheduler.ensureRecurringJob();
      this.worker = new Worker<StockExpiryJobData>(
        CATALOG_STOCK_EXPIRY_QUEUE,
        (job) => this.process(job),
        { connection, concurrency: 4 },
      );
      this.worker.on("failed", (job, err) => {
        this.logger.warn(`Stock expiry job failed ${job?.id ?? "unknown"}: ${err.message}`);
      });
    } else {
      // No Redis configured — use in-process timer fallback.
      this.timer = setInterval(() => {
        void this.releaseAndLog().catch((err) => {
          this.logger.warn(`Stock expiry timer failed: ${err instanceof Error ? err.message : String(err)}`);
        });
      }, 5 * 60 * 1_000);
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    await this.worker?.close();
  }

  private async process(job: Job<StockExpiryJobData>): Promise<void> {
    const released = await this.releaseAndLog();
    this.logger.log(`Stock expiry tick ${job.id ?? "n/a"} released=${released}`);
  }

  /** Runs a single sweep; exposed so tests can invoke without booting BullMQ. */
  async releaseAndLog(): Promise<number> {
    const released = await this.stockRepo.releaseExpired();
    if (released > 0) {
      this.logger.log(`Released ${released} expired stock reservation(s)`);
    }
    return released;
  }
}
