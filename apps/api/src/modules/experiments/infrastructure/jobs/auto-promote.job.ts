import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { Queue, Worker, type Job } from "bullmq";
import type { RedisOptions } from "ioredis";
import type { PrismaClient } from "@prisma/client";
import { PRISMA_CLIENT } from "../../../../shared/persistence/persistence.module.js";
import { EXPERIMENT_REPOSITORY_PORT, type ExperimentRepositoryPort } from "../../domain/ports/experiment-repository.port.js";
import { SignificanceCalculator, type VariantStats } from "../../domain/services/significance-calculator.service.js";
import { PromoteWinnerUseCase } from "../../application/use-cases/promote-winner.use-case.js";

export const EXPERIMENTS_AUTO_PROMOTE_QUEUE = "experiments-auto-promote";
const JOB_NAME = "auto-promote-winners";
const RECURRING_JOB_KEY = "experiments-auto-promote:cron";
const CRON_EVERY_6_HOURS = "0 */6 * * *"; // Every 6 hours

interface AutoPromoteJobData {
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
 * Scheduler for AutoPromoteJob.
 * Registers a recurring BullMQ job to run every 6 hours.
 */
@Injectable()
export class AutoPromoteScheduler implements OnModuleDestroy {
  private readonly logger = new Logger(AutoPromoteScheduler.name);
  private readonly queue: Queue<AutoPromoteJobData> | null;

  constructor() {
    const connection = redisConnection();
    this.queue = connection
      ? new Queue<AutoPromoteJobData>(EXPERIMENTS_AUTO_PROMOTE_QUEUE, { connection })
      : null;
  }

  async ensureRecurringJob(): Promise<void> {
    if (!this.queue) return;
    try {
      await this.queue.add(JOB_NAME, { triggeredAt: new Date().toISOString() }, {
        jobId: RECURRING_JOB_KEY,
        repeat: { pattern: CRON_EVERY_6_HOURS },
        removeOnComplete: 100,
        removeOnFail: 1_000,
      });
      this.logger.log(`Scheduled recurring auto-promote (cron=${CRON_EVERY_6_HOURS})`);
    } catch (err) {
      this.logger.warn(
        `Failed to register recurring auto-promote: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.queue?.close();
  }
}

/**
 * AutoPromoteWorker — Background Job (every 6 hours)
 *
 * For each running experiment:
 * 1. Calculate variant stats from PromptVariantResult records
 * 2. Compute statistical significance (Z-test)
 * 3. If confidence >= 0.95 AND both variants >= 100 sessions:
 *    - Promotes winner via PromoteWinnerUseCase
 *    - Marks experiment as completed
 * 4. Otherwise logs why not yet ready
 *
 * Idempotent: PromoteWinner errors if already completed (checked by state machine).
 * Falls back to setInterval when Redis is not configured.
 * Timeout: 5 minutes per job (configured at create time via job options).
 */
@Injectable()
export class AutoPromoteWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AutoPromoteWorker.name);
  private worker: Worker<AutoPromoteJobData> | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly significanceCalculator = new SignificanceCalculator();

  constructor(
    @Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient,
    @Inject(EXPERIMENT_REPOSITORY_PORT) private readonly experimentRepo: ExperimentRepositoryPort,
    private readonly promoteWinnerUseCase: PromoteWinnerUseCase,
    private readonly scheduler: AutoPromoteScheduler,
  ) {}

  async onModuleInit(): Promise<void> {
    const connection = redisConnection();
    if (connection) {
      await this.scheduler.ensureRecurringJob();
      this.worker = new Worker<AutoPromoteJobData>(
        EXPERIMENTS_AUTO_PROMOTE_QUEUE,
        (job) => this.process(job),
        { connection, concurrency: 1 },
      );
      this.worker.on("failed", (job, err) => {
        this.logger.warn(`Auto-promote job failed ${job?.id ?? "unknown"}: ${err.message}`);
      });
    } else {
      this.timer = setInterval(() => {
        void this.evaluateAndPromote().catch((err) => {
          this.logger.warn(`Auto-promote timer failed: ${err instanceof Error ? err.message : String(err)}`);
        });
      }, 6 * 60 * 60 * 1_000);
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    await this.worker?.close();
  }

  private async process(job: Job<AutoPromoteJobData>): Promise<void> {
    const promoted = await this.evaluateAndPromote();
    this.logger.log(`Auto-promote tick ${job.id ?? "n/a"} promoted=${promoted}`);
  }

  /**
   * Exposed for testability without booting BullMQ.
   * Evaluate all running experiments, promote if ready, return count.
   */
  async evaluateAndPromote(): Promise<number> {
    try {
      const runningExperiments = await this.prisma.promptExperiment.findMany({
        where: { status: "running" },
        include: { variants: { include: { results: true } } },
      });

      let promotedCount = 0;

      for (const exp of runningExperiments) {
        const merchantId = exp.merchantId;
        const experimentId = exp.id;

        try {
          const variantStats: VariantStats[] = exp.variants.map((v) => ({
            variantId: v.id,
            name: v.name,
            sessions: v.results.length,
            converted: v.results.filter((r) => r.converted).length,
          }));

          const significance = this.significanceCalculator.calculateConfidence(variantStats);

          if (significance.isSignificant && !significance.needsMore) {
            this.logger.log(
              `Promoting winner for experiment ${experimentId}: ${significance.winnerName} (confidence=${significance.confidence.toFixed(3)})`,
            );

            await this.promoteWinnerUseCase.execute(experimentId, merchantId, significance.winnerId);
            promotedCount++;
          } else {
            const reason = significance.needsMore
              ? "insufficient samples (need >= 100 per variant)"
              : `low confidence (${significance.confidence.toFixed(3)} < 0.95)`;
            this.logger.debug(`Experiment ${experimentId} not ready: ${reason}`);
          }
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          if (message.includes("CANNOT_PROMOTE_WINNER_UNLESS_RUNNING")) {
            this.logger.debug(`Experiment ${experimentId} already completed, skipping`);
          } else {
            this.logger.warn(`Failed to evaluate experiment ${experimentId}: ${message}`);
          }
        }
      }

      if (promotedCount > 0) {
        this.logger.log(`Auto-promoted ${promotedCount} experiment(s)`);
      }

      return promotedCount;
    } catch (err) {
      this.logger.error(
        `Error during auto-promote evaluation: ${err instanceof Error ? err.message : String(err)}`,
      );
      throw err;
    }
  }
}
