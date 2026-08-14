import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { Queue, Worker, type Job } from "bullmq";
import type { RedisOptions } from "ioredis";
import { AggregateDailyMetricsUseCase } from "../../application/use-cases/aggregate-daily-metrics.use-case.js";

export const METRICS_AGGREGATION_QUEUE = "store-metrics-aggregation";
const JOB_NAME = "aggregate-daily";
const RECURRING_JOB_KEY = "store-metrics-aggregation:cron";
const CRON_DAILY_1AM = "0 1 * * *";

interface MetricsJobData {
  triggeredAt: string;
  targetDate?: string;
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
export class MetricsAggregationScheduler implements OnModuleDestroy {
  private readonly logger = new Logger(MetricsAggregationScheduler.name);
  private readonly queue: Queue<MetricsJobData> | null;

  constructor() {
    const connection = redisConnection();
    this.queue = connection
      ? new Queue<MetricsJobData>(METRICS_AGGREGATION_QUEUE, { connection })
      : null;
  }

  async ensureRecurringJob(): Promise<void> {
    if (!this.queue) return;
    try {
      await this.queue.add(JOB_NAME, { triggeredAt: new Date().toISOString() }, {
        jobId: RECURRING_JOB_KEY,
        repeat: { pattern: CRON_DAILY_1AM },
        removeOnComplete: 30,
        removeOnFail: 100,
      });
      this.logger.log(`Scheduled recurring metrics aggregation (cron=${CRON_DAILY_1AM})`);
    } catch (err) {
      this.logger.warn(
        `Failed to register metrics aggregation: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.queue?.close();
  }
}

@Injectable()
export class MetricsAggregationWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MetricsAggregationWorker.name);
  private worker: Worker<MetricsJobData> | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly aggregateMetrics: AggregateDailyMetricsUseCase,
    private readonly scheduler: MetricsAggregationScheduler,
  ) {}

  async onModuleInit(): Promise<void> {
    const connection = redisConnection();
    if (connection) {
      await this.scheduler.ensureRecurringJob();
      this.worker = new Worker<MetricsJobData>(
        METRICS_AGGREGATION_QUEUE,
        (job) => this.process(job),
        { connection, concurrency: 1 },
      );
      this.worker.on("failed", (job, err) => {
        this.logger.warn(`Metrics aggregation job failed ${job?.id ?? "unknown"}: ${err.message}`);
      });
    } else {
      // No Redis — fallback: no automatic nightly aggregation without Redis
      this.logger.warn("Redis not configured; metrics aggregation cron disabled.");
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    await this.worker?.close();
  }

  private async process(job: Job<MetricsJobData>): Promise<void> {
    const targetDate = job.data.targetDate ? new Date(job.data.targetDate) : undefined;
    await this.aggregateMetrics.execute(targetDate);
    this.logger.log(`Metrics aggregation complete (job=${job.id ?? "n/a"})`);
  }
}
