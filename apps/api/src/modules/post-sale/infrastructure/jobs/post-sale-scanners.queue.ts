import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from "@nestjs/common";
import { Queue, Worker, type Job } from "bullmq";
import type { RedisOptions } from "ioredis";
import { ScanInactiveBuyersUseCase } from "../../application/use-cases/scan-inactive-buyers.use-case.js";
import { ScanConsumableReordersUseCase } from "../../application/use-cases/scan-consumable-reorders.use-case.js";

const WIN_BACK_QUEUE = "post-sale-win-back";
const REORDER_QUEUE = "post-sale-reorder";
const WIN_BACK_CRON = "0 6 * * *"; // daily 6am
const REORDER_CRON = "0 7 * * *"; // daily 7am
const DAILY_MS = 24 * 60 * 60 * 1_000;

interface ScannerJobData {
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

// ═══════════════════════════════════════════════════════════════════════════════
// WIN-BACK SCANNER
// ═══════════════════════════════════════════════════════════════════════════════

@Injectable()
export class WinBackScheduler implements OnModuleDestroy {
  private readonly logger = new Logger(WinBackScheduler.name);
  private readonly queue: Queue<ScannerJobData> | null;

  constructor() {
    const connection = redisConnection();
    this.queue = connection ? new Queue<ScannerJobData>(WIN_BACK_QUEUE, { connection }) : null;
  }

  async ensureRecurringJob(): Promise<void> {
    if (!this.queue) return;
    try {
      await this.queue.add(
        "scan-inactive-buyers",
        { triggeredAt: new Date().toISOString() },
        {
          jobId: "win-back:cron",
          repeat: { pattern: WIN_BACK_CRON },
          removeOnComplete: 30,
          removeOnFail: 100,
        },
      );
      this.logger.log("Win-back recurring job ensured");
    } catch (err) {
      this.logger.error("Failed to ensure win-back job", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.queue?.close();
  }
}

@Injectable()
export class WinBackWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(WinBackWorker.name);
  private worker: Worker<ScannerJobData> | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly scheduler: WinBackScheduler,
    private readonly useCase: ScanInactiveBuyersUseCase,
  ) {}

  async onModuleInit(): Promise<void> {
    const connection = redisConnection();
    if (connection) {
      await this.scheduler.ensureRecurringJob();
      this.worker = new Worker<ScannerJobData>(
        WIN_BACK_QUEUE,
        (job) => this.process(job),
        { connection, concurrency: 1 },
      );
      this.worker.on("failed", (job, err) => {
        this.logger.warn(`Win-back job failed ${job?.id ?? "unknown"}: ${err.message}`);
      });
      this.logger.log("win-back-scanner: BullMQ worker started");
    } else {
      this.timer = setInterval(() => {
        void this.run().catch((err) => {
          this.logger.error("win-back-scanner fallback error", {
            error: err instanceof Error ? err.message : String(err),
          });
        });
      }, DAILY_MS);
      this.logger.log("win-back-scanner: setInterval fallback (no REDIS_URL)");
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    await this.worker?.close();
  }

  private async process(job: Job<ScannerJobData>): Promise<void> {
    const stats = await this.run();
    if (stats.couponsCreated > 0) {
      this.logger.log(`win-back-scanner tick ${job.id ?? "n/a"}`, stats);
    }
  }

  async run(): Promise<{ processed: number; couponsCreated: number }> {
    return this.useCase.execute();
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// CONSUMABLE REORDER SCANNER
// ═══════════════════════════════════════════════════════════════════════════════

@Injectable()
export class ConsumableReorderScheduler implements OnModuleDestroy {
  private readonly logger = new Logger(ConsumableReorderScheduler.name);
  private readonly queue: Queue<ScannerJobData> | null;

  constructor() {
    const connection = redisConnection();
    this.queue = connection ? new Queue<ScannerJobData>(REORDER_QUEUE, { connection }) : null;
  }

  async ensureRecurringJob(): Promise<void> {
    if (!this.queue) return;
    try {
      await this.queue.add(
        "scan-consumable-reorders",
        { triggeredAt: new Date().toISOString() },
        {
          jobId: "reorder:cron",
          repeat: { pattern: REORDER_CRON },
          removeOnComplete: 30,
          removeOnFail: 100,
        },
      );
      this.logger.log("Consumable-reorder recurring job ensured");
    } catch (err) {
      this.logger.error("Failed to ensure reorder job", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.queue?.close();
  }
}

@Injectable()
export class ConsumableReorderWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ConsumableReorderWorker.name);
  private worker: Worker<ScannerJobData> | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly scheduler: ConsumableReorderScheduler,
    private readonly useCase: ScanConsumableReordersUseCase,
  ) {}

  async onModuleInit(): Promise<void> {
    const connection = redisConnection();
    if (connection) {
      await this.scheduler.ensureRecurringJob();
      this.worker = new Worker<ScannerJobData>(
        REORDER_QUEUE,
        (job) => this.process(job),
        { connection, concurrency: 1 },
      );
      this.worker.on("failed", (job, err) => {
        this.logger.warn(`Reorder job failed ${job?.id ?? "unknown"}: ${err.message}`);
      });
      this.logger.log("consumable-reorder-scanner: BullMQ worker started");
    } else {
      this.timer = setInterval(() => {
        void this.run().catch((err) => {
          this.logger.error("consumable-reorder-scanner fallback error", {
            error: err instanceof Error ? err.message : String(err),
          });
        });
      }, DAILY_MS);
      this.logger.log("consumable-reorder-scanner: setInterval fallback (no REDIS_URL)");
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    await this.worker?.close();
  }

  private async process(job: Job<ScannerJobData>): Promise<void> {
    const stats = await this.run();
    if (stats.scheduled > 0) {
      this.logger.log(`consumable-reorder-scanner tick ${job.id ?? "n/a"}`, stats);
    }
  }

  async run(): Promise<{ processed: number; scheduled: number }> {
    return this.useCase.execute();
  }
}
