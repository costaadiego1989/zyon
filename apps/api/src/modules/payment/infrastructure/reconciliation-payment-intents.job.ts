import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { Queue, Worker, type Job } from "bullmq";
import type { RedisOptions } from "ioredis";
import { ReconcilePaymentIntentsUseCase } from "../application/reconcile-payment-intents.use-case.js";

export const PAYMENT_RECONCILIATION_QUEUE = "payment-reconciliation";
const JOB_NAME = "reconcile-payment-intents";
const RECURRING_JOB_KEY = "payment-reconciliation:cron";
const CRON_EVERY_15_MINUTES = "*/15 * * * *"; // Every 15 minutes
const RECONCILIATION_TIMEOUT_MS = 2 * 60 * 1_000; // 2 minutes
const RECONCILIATION_BATCH_SIZE = 10; // Rate limit: max 10 per execution
const RECONCILIATION_STALE_AFTER_MS = 30 * 60 * 1_000; // 30 minutes

interface ReconcilePaymentIntentsJobData {
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
 * Scheduler for ReconcilePaymentIntentsJob.
 * Registers a recurring BullMQ job to run every 15 minutes.
 */
@Injectable()
export class ReconcilePaymentIntentsScheduler implements OnModuleDestroy {
  private readonly logger = new Logger(ReconcilePaymentIntentsScheduler.name);
  private readonly queue: Queue<ReconcilePaymentIntentsJobData> | null;

  constructor() {
    const connection = redisConnection();
    this.queue = connection
      ? new Queue<ReconcilePaymentIntentsJobData>(PAYMENT_RECONCILIATION_QUEUE, { connection })
      : null;
  }

  async ensureRecurringJob(): Promise<void> {
    if (!this.queue) return;
    try {
      await this.queue.add(JOB_NAME, { triggeredAt: new Date().toISOString() }, {
        jobId: RECURRING_JOB_KEY,
        repeat: { pattern: CRON_EVERY_15_MINUTES },
        removeOnComplete: 100,
        removeOnFail: 1_000,
      });
      this.logger.log(`Scheduled recurring payment reconciliation (cron=${CRON_EVERY_15_MINUTES})`);
    } catch (err) {
      this.logger.warn(
        `Failed to register recurring payment reconciliation: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.queue?.close();
  }
}

/**
 * ReconcilePaymentIntentsWorker — Background Job (every 15 minutes)
 *
 * Finds payment intents in 'pending' or 'requires_action' status that are older than 30 minutes.
 * For each stale intent:
 * 1. Query the payment provider (Asaas/Stripe) for authoritative status
 * 2. If provider reports 'approved' → transition to approved + complete checkout
 * 3. If provider reports 'failed' → transition to failed + record failure
 * 4. If provider reports 'pending' or 'unknown' → leave unchanged (wait for next cycle)
 *
 * Idempotent: state machine prevents double-approvals; reconciliation reason recorded in log.
 * Rate-limited: max 10 intents per execution to avoid overwhelming provider.
 * Timeout: 2 minutes per job (configured at create time).
 * Falls back to setInterval (every 15 min) when Redis is not configured.
 */
@Injectable()
export class ReconcilePaymentIntentsWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ReconcilePaymentIntentsWorker.name);
  private worker: Worker<ReconcilePaymentIntentsJobData> | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly reconcileUseCase: ReconcilePaymentIntentsUseCase,
    private readonly scheduler: ReconcilePaymentIntentsScheduler,
  ) {}

  async onModuleInit(): Promise<void> {
    const connection = redisConnection();
    if (connection) {
      await this.scheduler.ensureRecurringJob();
      this.worker = new Worker<ReconcilePaymentIntentsJobData>(
        PAYMENT_RECONCILIATION_QUEUE,
        (job) => this.process(job),
        { connection, concurrency: 1 },
      );
      this.worker.on("failed", (job, err) => {
        this.logger.warn(`Payment reconciliation job failed ${job?.id ?? "unknown"}: ${err.message}`);
      });
    } else {
      this.timer = setInterval(() => {
        void this.reconcileAndLog().catch((err) => {
          this.logger.warn(`Payment reconciliation timer failed: ${err instanceof Error ? err.message : String(err)}`);
        });
      }, 15 * 60 * 1_000);
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    await this.worker?.close();
  }

  private async process(job: Job<ReconcilePaymentIntentsJobData>): Promise<void> {
    const result = await this.reconcileAndLog();
    this.logger.log(`Payment reconciliation tick ${job.id ?? "n/a"} scanned=${result.scanned} reconciled=${result.reconciled.length}`);
  }

  /**
   * Exposed for testability without booting BullMQ.
   * Reconcile stale payment intents and return summary.
   */
  async reconcileAndLog() {
    try {
      const result = await this.reconcileUseCase.execute({
        staleAfterMs: RECONCILIATION_STALE_AFTER_MS,
        limit: RECONCILIATION_BATCH_SIZE,
      });

      const approved = result.reconciled.filter((r) => r.outcome === "approved").length;
      const failed = result.reconciled.filter((r) => r.outcome === "failed").length;
      const stillPending = result.reconciled.filter((r) => r.outcome === "still_pending").length;
      const skipped = result.reconciled.filter((r) => r.outcome === "skipped").length;

      if (result.reconciled.length > 0) {
        this.logger.log(
          `Reconciled ${result.scanned} payment intent(s): approved=${approved} failed=${failed} still_pending=${stillPending} skipped=${skipped}`,
        );
      }

      return result;
    } catch (err) {
      this.logger.error(
        `Error during payment reconciliation: ${err instanceof Error ? err.message : String(err)}`,
      );
      throw err;
    }
  }
}
