import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { Queue, Worker, type Job } from "bullmq";
import type { RedisOptions } from "ioredis";
import { ReconcilePendingRefundsUseCase } from "../application/use-cases/reconcile-pending-refunds.use-case.js";

export const RETURN_REFUND_RECONCILIATION_QUEUE = "return-refund-reconciliation";
const JOB_NAME = "reconcile-pending-return-refunds";
const RECURRING_JOB_KEY = "return-refund-reconciliation:cron";
const CRON_EVERY_15_MINUTES = "*/15 * * * *";
const STALE_AFTER_MS = 30 * 60 * 1_000;
const BATCH_SIZE = 10;

type JobData = { triggeredAt: string };

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
export class ReconcilePendingRefundsScheduler implements OnModuleDestroy {
  private readonly queue: Queue<JobData> | null;

  constructor() {
    const connection = redisConnection();
    this.queue = connection ? new Queue<JobData>(RETURN_REFUND_RECONCILIATION_QUEUE, { connection }) : null;
  }

  async ensureRecurringJob(): Promise<void> {
    if (!this.queue) return;
    await this.queue.add(JOB_NAME, { triggeredAt: new Date().toISOString() }, {
      jobId: RECURRING_JOB_KEY,
      repeat: { pattern: CRON_EVERY_15_MINUTES },
      removeOnComplete: 100,
      removeOnFail: 1_000,
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.queue?.close();
  }
}

/** Periodic, read-only PSP reconciliation for durable pending return refunds. */
@Injectable()
export class ReconcilePendingRefundsWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ReconcilePendingRefundsWorker.name);
  private worker: Worker<JobData> | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly reconcile: ReconcilePendingRefundsUseCase,
    private readonly scheduler: ReconcilePendingRefundsScheduler,
  ) {}

  async onModuleInit(): Promise<void> {
    const connection = redisConnection();
    if (connection) {
      try {
        await this.scheduler.ensureRecurringJob();
        this.worker = new Worker<JobData>(
          RETURN_REFUND_RECONCILIATION_QUEUE,
          (job) => this.process(job),
          { connection, concurrency: 1 },
        );
        this.worker.on("failed", (job, error) => {
          this.logger.warn(`Return refund reconciliation job failed ${job?.id ?? "unknown"}: ${error.message}`);
        });
      } catch (error) {
        this.logger.warn(`Unable to start return refund reconciliation worker: ${error instanceof Error ? error.message : String(error)}`);
      }
    } else {
      this.timer = setInterval(() => void this.reconcileAndLog(), 15 * 60 * 1_000);
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    await this.worker?.close();
  }

  private async process(job: Job<JobData>): Promise<void> {
    const result = await this.reconcileAndLog();
    this.logger.log(`Return refund reconciliation tick ${job.id ?? "n/a"} scanned=${result.scanned}`);
  }

  async reconcileAndLog() {
    try {
      const result = await this.reconcile.execute({ staleAfterMs: STALE_AFTER_MS, limit: BATCH_SIZE });
      if (result.scanned > 0) {
        const completed = result.reconciled.filter((item) => item.outcome === "completed").length;
        const failed = result.reconciled.filter((item) => item.outcome === "failed").length;
        this.logger.log(`Reconciled ${result.scanned} return refund(s): completed=${completed} failed=${failed}`);
      }
      return result;
    } catch (error) {
      this.logger.error(`Return refund reconciliation failed: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }
  }
}
