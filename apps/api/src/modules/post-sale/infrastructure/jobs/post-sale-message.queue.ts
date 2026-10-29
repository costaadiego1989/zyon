import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from "@nestjs/common";
import { Queue, Worker, type Job } from "bullmq";
import type { RedisOptions } from "ioredis";
import { ProcessScheduledMessagesUseCase } from "../../application/use-cases/process-scheduled-messages.use-case.js";

export const POST_SALE_MSG_QUEUE = "post-sale-message-sender";
const JOB_NAME = "process-scheduled";
const RECURRING_JOB_KEY = "post-sale-msg:cron";
const CRON_EVERY_5_MIN = "*/5 * * * *";
const FALLBACK_INTERVAL_MS = 5 * 60 * 1_000;

interface PostSaleMsgJobData {
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

// ─── Scheduler ────────────────────────────────────────────────────────────────

@Injectable()
export class PostSaleMessageScheduler implements OnModuleDestroy {
  private readonly logger = new Logger(PostSaleMessageScheduler.name);
  private readonly queue: Queue<PostSaleMsgJobData> | null;

  constructor() {
    const connection = redisConnection();
    this.queue = connection
      ? new Queue<PostSaleMsgJobData>(POST_SALE_MSG_QUEUE, { connection })
      : null;
  }

  async ensureRecurringJob(): Promise<void> {
    if (!this.queue) return;
    try {
      await this.queue.add(
        JOB_NAME,
        { triggeredAt: new Date().toISOString() },
        {
          jobId: RECURRING_JOB_KEY,
          repeat: { pattern: CRON_EVERY_5_MIN },
          removeOnComplete: 100,
          removeOnFail: 1_000,
        },
      );
      this.logger.log("Recurring post-sale message job ensured");
    } catch (err) {
      this.logger.error("Failed to ensure recurring job", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.queue?.close();
  }
}

// ─── Worker ───────────────────────────────────────────────────────────────────

@Injectable()
export class PostSaleMessageWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PostSaleMessageWorker.name);
  private worker: Worker<PostSaleMsgJobData> | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly scheduler: PostSaleMessageScheduler,
    private readonly useCase: ProcessScheduledMessagesUseCase,
  ) {}

  async onModuleInit(): Promise<void> {
    const connection = redisConnection();
    if (connection) {
      await this.scheduler.ensureRecurringJob();
      this.worker = new Worker<PostSaleMsgJobData>(
        POST_SALE_MSG_QUEUE,
        (job) => this.process(job),
        {
          connection,
          concurrency: 1,
          limiter: { max: 10, duration: 60_000 },
        },
      );
      this.worker.on("failed", (job, err) => {
        this.logger.warn(`Post-sale message job failed ${job?.id ?? "unknown"}: ${err.message}`);
      });
      this.logger.log("post-sale-message-sender: BullMQ worker started");
    } else {
      this.timer = setInterval(() => {
        void this.processAndLog().catch((err) => {
          this.logger.error("post-sale-message-sender fallback error", {
            error: err instanceof Error ? err.message : String(err),
          });
        });
      }, FALLBACK_INTERVAL_MS);
      this.logger.log("post-sale-message-sender: setInterval fallback (no REDIS_URL)");
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    await this.worker?.close();
  }

  private async process(job: Job<PostSaleMsgJobData>): Promise<void> {
    const stats = await this.processAndLog();
    this.logger.log(`post-sale-message-sender tick ${job.id ?? "n/a"}`, stats);
  }

  async processAndLog(): Promise<{ processed: number; sent: number; failed: number }> {
    return this.useCase.execute();
  }
}
