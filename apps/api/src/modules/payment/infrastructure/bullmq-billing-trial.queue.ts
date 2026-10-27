import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { Queue, Worker, type Job } from "bullmq";
import type { RedisOptions } from "ioredis";
import type { BillingTrialJobQueue } from "../domain/ports/billing-trial-job-queue.port.js";
import { ExpireBillingTrialUseCase } from "../application/payment-platform.use-cases.js";

const QUEUE_NAME = "billing-trial-expiration";
const JOB_NAME = "expire-trial";
const MAX_DELAY_MS = 2_147_483_647;

interface BillingTrialExpirationJobData {
  merchantId: string;
  trialEndsAt: string;
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
export class BullMqBillingTrialQueue implements BillingTrialJobQueue, OnModuleDestroy {
  private readonly queue: Queue<BillingTrialExpirationJobData> | null;

  constructor() {
    const connection = redisConnection();
    this.queue = connection ? new Queue<BillingTrialExpirationJobData>(QUEUE_NAME, { connection }) : null;
  }

  async scheduleTrialExpiration(input: BillingTrialExpirationJobData): Promise<void> {
    if (!this.queue) return;
    const delay = Math.max(0, new Date(input.trialEndsAt).getTime() - Date.now());
    await this.queue.add(JOB_NAME, input, {
      jobId: `trial-${Buffer.from(input.merchantId).toString("base64url")}`,
      delay: Math.min(delay, MAX_DELAY_MS),
      attempts: 5,
      backoff: { type: "exponential", delay: 60_000 },
      removeOnComplete: true,
      removeOnFail: 1_000,
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.queue?.close();
  }
}

@Injectable()
export class BullMqBillingTrialWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(BullMqBillingTrialWorker.name);
  private worker: Worker<BillingTrialExpirationJobData> | null = null;

  constructor(private readonly expireTrial: ExpireBillingTrialUseCase) {}

  onModuleInit(): void {
    const connection = redisConnection();
    if (!connection) return;
    this.worker = new Worker<BillingTrialExpirationJobData>(
      QUEUE_NAME,
      (job) => this.process(job),
      { connection, concurrency: 10 },
    );
    this.worker.on("failed", (job, err) => {
      this.logger.warn(`Billing trial job failed ${job?.id ?? "unknown"}: ${err.message}`);
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
  }

  private async process(job: Job<BillingTrialExpirationJobData>): Promise<void> {
    const { merchantId } = job.data;
    if (!merchantId?.trim()) return;
    const expired = await this.expireTrial.execute({ merchantId });
    if (expired) {
      this.logger.log(`Expired billing trial to Starter for merchant ${merchantId}`);
    }
  }
}
