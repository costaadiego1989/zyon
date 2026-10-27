import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit, Optional } from "@nestjs/common";
import { Queue, Worker, type Job } from "bullmq";
import type { RedisOptions } from "ioredis";
import { S3UploadService } from "../../../../shared/storage/s3-upload.service.js";
import type { ImportQueuePort } from "../../domain/ports/import-queue.port.js";
import { IMPORT_JOB_REPOSITORY, type ImportJobRepositoryPort } from "../../domain/ports/import-job-repository.port.js";
import { ProcessSpreadsheetImportUseCase } from "../../application/use-cases/process-spreadsheet-import.use-case.js";

export const SPREADSHEET_IMPORT_QUEUE = "catalog-spreadsheet-import";
const JOB_NAME = "process-import";

interface SpreadsheetImportJobData {
  jobId: string;
  merchantId: string;
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
 * Consumes the spreadsheet-import queue and runs ProcessSpreadsheetImportUseCase.
 * Retrieves the uploaded file from its S3 fileRef. Also exposes runInline() used
 * by the scheduler when Redis is absent (dev). Declared BEFORE the scheduler so
 * the scheduler's constructor can reference this class at load time.
 */
@Injectable()
export class SpreadsheetImportWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SpreadsheetImportWorker.name);
  private worker: Worker<SpreadsheetImportJobData> | null = null;

  constructor(
    private readonly processImport: ProcessSpreadsheetImportUseCase,
    @Inject(IMPORT_JOB_REPOSITORY) private readonly jobRepo: ImportJobRepositoryPort,
    @Optional() private readonly s3?: S3UploadService,
  ) {}

  async onModuleInit(): Promise<void> {
    const connection = redisConnection();
    if (!connection) return; // dev: scheduler runs inline instead
    this.worker = new Worker<SpreadsheetImportJobData>(
      SPREADSHEET_IMPORT_QUEUE,
      (job) => this.runInline(job.data.jobId, job.data.merchantId),
      { connection, concurrency: 2 },
    );
    this.worker.on("failed", (job, err) => {
      this.logger.warn(`Import job failed ${job?.data?.jobId ?? "unknown"}: ${err.message}`);
    });
  }

  /** Resolve the job's file bytes and run the import use-case. */
  async runInline(jobId: string, merchantId: string): Promise<void> {
    const job = await this.jobRepo.getById(jobId, merchantId);
    if (!job) {
      this.logger.warn(`Import job ${jobId} not found for merchant ${merchantId}`);
      return;
    }
    if (!job.fileRef) {
      await this.jobRepo.update(jobId, merchantId, {
        status: "failed",
        errors: [{ row: 0, reason: "file_unavailable" }],
        finishedAt: new Date(),
      });
      return;
    }
    let buffer: Buffer;
    let mimeType = "text/csv";
    try {
      const fetched = await this.fetchFile(job.fileRef);
      buffer = fetched.buffer;
      mimeType = fetched.mimeType ?? mimeType;
    } catch (err) {
      this.logger.warn(`Import ${jobId} file fetch failed: ${err instanceof Error ? err.message : String(err)}`);
      await this.jobRepo.update(jobId, merchantId, {
        status: "failed",
        errors: [{ row: 0, reason: "file_fetch_failed" }],
        finishedAt: new Date(),
      });
      return;
    }
    await this.processImport.execute({ jobId, merchantId, buffer, mimeType });
  }

  private async fetchFile(fileRef: string): Promise<{ buffer: Buffer; mimeType?: string }> {
    const res = await fetch(fileRef);
    if (!res.ok) throw new Error(`fetch ${res.status}`);
    const arrayBuf = await res.arrayBuffer();
    return { buffer: Buffer.from(arrayBuf), mimeType: res.headers.get("content-type") ?? undefined };
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
  }
}

/**
 * Enqueues spreadsheet-import jobs. When Redis is present, pushes to BullMQ;
 * otherwise processes inline (dev) via the injected worker so the flow still
 * works without a broker. Implements ImportQueuePort.
 */
@Injectable()
export class SpreadsheetImportScheduler implements ImportQueuePort, OnModuleDestroy {
  private readonly logger = new Logger(SpreadsheetImportScheduler.name);
  private readonly queue: Queue<SpreadsheetImportJobData> | null;

  constructor(
    @Optional() private readonly worker?: SpreadsheetImportWorker,
  ) {
    const connection = redisConnection();
    this.queue = connection
      ? new Queue<SpreadsheetImportJobData>(SPREADSHEET_IMPORT_QUEUE, { connection })
      : null;
  }

  async enqueue(jobId: string, merchantId: string): Promise<void> {
    if (this.queue) {
      await this.queue.add(JOB_NAME, { jobId, merchantId }, {
        jobId: `import:${jobId}`,
        removeOnComplete: 100,
        removeOnFail: 1_000,
      });
      this.logger.log(`Enqueued spreadsheet import ${jobId} (merchant=${merchantId})`);
      return;
    }
    // No Redis (dev): process inline, best-effort, non-blocking.
    this.logger.log(`Redis absent — processing import ${jobId} inline`);
    void this.worker?.runInline(jobId, merchantId).catch((err) => {
      this.logger.warn(`Inline import ${jobId} failed: ${err instanceof Error ? err.message : String(err)}`);
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.queue?.close();
  }
}
