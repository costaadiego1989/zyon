import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { Queue, Worker, type Job } from "bullmq";
import type { RedisOptions } from "ioredis";
import { ConfirmCryptoPaymentUseCase, type ConfirmCryptoPaymentRequest } from "../application/confirm-crypto-payment.use-case.js";

const QUEUE_NAME = "crypto-verify";
const JOB_NAME = "verify-transfer";

export interface CryptoVerifyJobData extends ConfirmCryptoPaymentRequest {}

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
export class BullMqCryptoVerifyQueue implements OnModuleDestroy {
  private readonly logger = new Logger(BullMqCryptoVerifyQueue.name);
  private readonly queue: Queue<CryptoVerifyJobData> | null;

  constructor() {
    const connection = redisConnection();
    this.queue = connection ? new Queue<CryptoVerifyJobData>(QUEUE_NAME, { connection }) : null;
  }

  /** Returns true if job was enqueued; false if Redis unavailable (caller should fall back to sync). */
  async enqueue(data: CryptoVerifyJobData): Promise<boolean> {
    if (!this.queue) return false;
    await this.queue.add(JOB_NAME, data, {
      jobId: `crypto-verify:${data.intent_id}`,
      attempts: 5,
      backoff: { type: "exponential", delay: 2000 }, // 2s, 4s, 8s, 16s, 32s
      removeOnComplete: true,
      removeOnFail: 1000,
    });
    this.logger.log(`Enqueued crypto verify job for intent ${data.intent_id}`);
    return true;
  }

  async onModuleDestroy(): Promise<void> {
    await this.queue?.close();
  }
}

@Injectable()
export class BullMqCryptoVerifyWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(BullMqCryptoVerifyWorker.name);
  private worker: Worker<CryptoVerifyJobData> | null = null;

  constructor(private readonly confirmCrypto: ConfirmCryptoPaymentUseCase) {}

  onModuleInit(): void {
    const connection = redisConnection();
    if (!connection) return;
    this.worker = new Worker<CryptoVerifyJobData>(
      QUEUE_NAME,
      (job) => this.process(job),
      { connection, concurrency: 5 },
    );
    this.worker.on("failed", (job, err) => {
      this.logger.error(`Crypto verify FINAL failure for ${job?.id ?? "unknown"}: ${err.message}`);
      // After all retries exhausted, intent stays in "requires_action" state.
      // Ops team should monitor this queue's failed jobs.
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
  }

  private async process(job: Job<CryptoVerifyJobData>): Promise<void> {
    const { intent_id } = job.data;
    this.logger.log(`Processing crypto verify job ${intent_id} (attempt ${job.attemptsMade + 1}/${job.opts.attempts})`);
    await this.confirmCrypto.execute(job.data);
    this.logger.log(`Crypto verify succeeded for intent ${intent_id}`);
  }
}
