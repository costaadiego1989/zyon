import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { Queue, Worker, type Job } from "bullmq";
import type { RedisOptions } from "ioredis";
import type { PrismaClient } from "@prisma/client";
import { PRISMA_CLIENT } from "../../../../shared/persistence/persistence.module.js";
import { RecordExperimentResultUseCase } from "../../application/use-cases/record-experiment-result.use-case.js";

export const EXPERIMENTS_EXPIRE_SESSIONS_QUEUE = "experiments-expire-sessions";
const JOB_NAME = "expire-old-sessions";
const RECURRING_JOB_KEY = "experiments-expire-sessions:cron";
const CRON_EVERY_HOUR = "0 * * * *"; // Every hour

interface ExpireSessionsJobData {
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
 * Scheduler for ExpireSessionsJob.
 * Registers a recurring BullMQ job to run every hour.
 */
@Injectable()
export class ExpireSessionsScheduler implements OnModuleDestroy {
  private readonly logger = new Logger(ExpireSessionsScheduler.name);
  private readonly queue: Queue<ExpireSessionsJobData> | null;

  constructor() {
    const connection = redisConnection();
    this.queue = connection
      ? new Queue<ExpireSessionsJobData>(EXPERIMENTS_EXPIRE_SESSIONS_QUEUE, { connection })
      : null;
  }

  async ensureRecurringJob(): Promise<void> {
    if (!this.queue) return;
    try {
      await this.queue.add(JOB_NAME, { triggeredAt: new Date().toISOString() }, {
        jobId: RECURRING_JOB_KEY,
        repeat: { pattern: CRON_EVERY_HOUR },
        removeOnComplete: 100,
        removeOnFail: 1_000,
      });
      this.logger.log(`Scheduled recurring expire sessions (cron=${CRON_EVERY_HOUR})`);
    } catch (err) {
      this.logger.warn(
        `Failed to register recurring expire sessions: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.queue?.close();
  }
}

/**
 * ExpireSessionsWorker — Background Job (every 1 hour)
 *
 * Finds checkout sessions older than 24h that:
 * - Have a promptVariantId (enrolled in an experiment)
 * - Have NOT completed (no CompletedOrder)
 *
 * For each such session, records converted=false via RecordExperimentResultUseCase.
 * Idempotent: upsert on (variantId, sessionId) means running 2x produces same result.
 *
 * Falls back to setInterval when Redis is not configured.
 */
@Injectable()
export class ExpireSessionsWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ExpireSessionsWorker.name);
  private worker: Worker<ExpireSessionsJobData> | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    @Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient,
    private readonly recordResultUseCase: RecordExperimentResultUseCase,
    private readonly scheduler: ExpireSessionsScheduler,
  ) {}

  async onModuleInit(): Promise<void> {
    const connection = redisConnection();
    if (connection) {
      await this.scheduler.ensureRecurringJob();
      this.worker = new Worker<ExpireSessionsJobData>(
        EXPERIMENTS_EXPIRE_SESSIONS_QUEUE,
        (job) => this.process(job),
        { connection, concurrency: 1 },
      );
      this.worker.on("failed", (job, err) => {
        this.logger.warn(`Expire sessions job failed ${job?.id ?? "unknown"}: ${err.message}`);
      });
    } else {
      this.timer = setInterval(() => {
        void this.expireAndLog().catch((err) => {
          this.logger.warn(`Expire sessions timer failed: ${err instanceof Error ? err.message : String(err)}`);
        });
      }, 60 * 60 * 1_000);
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    await this.worker?.close();
  }

  private async process(job: Job<ExpireSessionsJobData>): Promise<void> {
    const count = await this.expireAndLog();
    this.logger.log(`Expire sessions tick ${job.id ?? "n/a"} expired=${count}`);
  }

  /**
   * Exposed for testability without booting BullMQ.
   * Find expired sessions, record as not-converted, return count.
   */
  async expireAndLog(): Promise<number> {
    const now = new Date();
    const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    try {
      const sessionsToExpire = await this.prisma.checkoutSession.findMany({
        where: {
          promptVariantId: { not: null },
          createdAt: { lt: twentyFourHoursAgo },
          completedOrders: { none: {} },
        },
        select: {
          merchantId: true,
          sessionId: true,
        },
      });

      let recordedCount = 0;

      for (const session of sessionsToExpire) {
        try {
          await this.recordResultUseCase.execute({
            merchantId: session.merchantId,
            sessionId: session.sessionId,
            converted: false,
          });
          recordedCount++;
        } catch (err) {
          // Don't fail entire job if one session record fails
          this.logger.warn(
            `Failed to record expired session ${session.sessionId}: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }

      if (recordedCount > 0) {
        this.logger.log(`Expired and recorded ${recordedCount} session(s) as not converted`);
      }

      return recordedCount;
    } catch (err) {
      this.logger.error(
        `Error during expire sessions sweep: ${err instanceof Error ? err.message : String(err)}`,
      );
      throw err;
    }
  }
}
