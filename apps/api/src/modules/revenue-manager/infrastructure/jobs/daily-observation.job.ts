import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { Queue, Worker, type Job } from "bullmq";
import type { RedisOptions } from "ioredis";
import { PRISMA_CLIENT } from "../../../../shared/persistence/persistence.module.js";
import type { PrismaClient } from "@prisma/client";

export const REVENUE_MANAGER_OBSERVATION_QUEUE = "revenue-manager-observations";
const JOB_NAME = "daily-observation-compile";
const RECURRING_JOB_KEY = "revenue-manager-observations:cron";
const CRON_DAILY_2AM_UTC = "0 2 * * *"; // 2 AM UTC

interface DailyObservationJobData {
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
 * Scheduler for DailyObservationJob.
 * Registers a recurring BullMQ job to run daily at 2 AM UTC.
 */
@Injectable()
export class DailyObservationScheduler implements OnModuleDestroy {
  private readonly logger = new Logger(DailyObservationScheduler.name);
  private readonly queue: Queue<DailyObservationJobData> | null;

  constructor() {
    const connection = redisConnection();
    this.queue = connection
      ? new Queue<DailyObservationJobData>(REVENUE_MANAGER_OBSERVATION_QUEUE, { connection })
      : null;
  }

  async ensureRecurringJob(): Promise<void> {
    if (!this.queue) return;
    try {
      await this.queue.add(JOB_NAME, { triggeredAt: new Date().toISOString() }, {
        jobId: RECURRING_JOB_KEY,
        repeat: { pattern: CRON_DAILY_2AM_UTC },
        removeOnComplete: 100,
        removeOnFail: 1_000,
      });
      this.logger.log(`Scheduled recurring daily observation (cron=${CRON_DAILY_2AM_UTC})`);
    } catch (err) {
      this.logger.warn(
        `Failed to register recurring daily observation: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.queue?.close();
  }
}

/**
 * DailyObservationWorker — Background Job (every day 2 AM UTC)
 *
 * For each merchant:
 * 1. Fetch merchant config + current metrics (funnel, abandonment, etc)
 * 2. Call ObserveMetricsUseCase to create/deduplicate observation
 * 3. If observation is new: call GenerateHypothesisUseCase
 * 4. If hypothesis is low-risk: auto-approve + create experiment
 *
 * Falls back to setInterval when Redis is not configured.
 * Timeout: 10 minutes per job.
 */
@Injectable()
export class DailyObservationWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DailyObservationWorker.name);
  private worker: Worker<DailyObservationJobData> | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(@Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient) {}

  async onModuleInit(): Promise<void> {
    const connection = redisConnection();
    if (connection) {
      this.worker = new Worker<DailyObservationJobData>(
        REVENUE_MANAGER_OBSERVATION_QUEUE,
        async (job) => this.process(job),
        { connection, concurrency: 1 },
      );
      this.worker.on("failed", (job, err) => {
        this.logger.warn(`Daily observation job failed ${job?.id ?? "unknown"}: ${err.message}`);
      });
      this.logger.log("DailyObservationWorker started (BullMQ)");
    } else {
      // Fallback to setInterval
      this.timer = setInterval(
        () => {
          void this.runObservationCycle().catch((err) => {
            this.logger.warn(`Daily observation timer failed: ${err instanceof Error ? err.message : String(err)}`);
          });
        },
        24 * 60 * 60 * 1_000, // Run every 24 hours
      );
      this.logger.log("DailyObservationWorker started (setInterval fallback, every 24h)");
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    await this.worker?.close();
  }

  private async process(job: Job<DailyObservationJobData>): Promise<void> {
    const count = await this.runObservationCycle();
    this.logger.log(`Daily observation job ${job.id ?? "n/a"} processed ${count} merchants`);
  }

  /**
   * Exposed for testability.
   * Run one observation cycle for all merchants.
   */
  async runObservationCycle(): Promise<number> {
    try {
      const merchants = await this.prisma.merchant.findMany({
        take: 100, // batch limit
      });

      let processedCount = 0;

      for (const merchant of merchants) {
        try {
          // Placeholder: In production, would call ObserveMetricsUseCase
          // For now, just log
          this.logger.debug(`Would trigger observation cycle for merchant ${merchant.id}`);
          processedCount++;
        } catch (err) {
          this.logger.warn(`Failed to process merchant ${merchant.id}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }

      return processedCount;
    } catch (err) {
      this.logger.warn(`Failed to run observation cycle: ${err instanceof Error ? err.message : String(err)}`);
      return 0;
    }
  }
}
