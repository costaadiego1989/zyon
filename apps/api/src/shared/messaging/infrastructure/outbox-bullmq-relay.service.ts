import { Inject, Injectable, Logger, OnModuleInit, OnModuleDestroy, Optional } from "@nestjs/common";
import { Queue, Worker, type Job } from "bullmq";
import type { RedisOptions } from "ioredis";
import { OutboxDispatcher } from "../outbox-dispatcher.service.js";
import { Gauge } from "prom-client";
import { MetricsService } from "../../observability/metrics.service.js";

export const OUTBOX_RELAY_QUEUE = "domain-event-outbox";
const JOB_NAME = "drain-outbox";
const RECURRING_JOB_KEY = "outbox-relay:cron";
const CRON_EVERY_SECOND = "* * * * *"; // every minute; Worker runs dispatch ~60×/min internally

interface OutboxRelayJobData {
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
 * BullMQ-backed outbox relay. Replaces the in-process `setInterval(100ms)` in
 * OutboxDispatcher with a Redis-locked recurring job.
 *
 * Benefits over setInterval:
 * - Distributed lock: only 1 instance processes at a time (no duplicate event delivery)
 * - Observable: BullMQ dashboard shows backlog/failures
 * - Crash-resilient: if the worker dies, another instance picks up
 *
 * The relay reuses OutboxDispatcher.dispatch() which already handles:
 * - batch claiming (claimBatch)
 * - per-handler idempotency (outbox_handler_executions)
 * - exponential backoff on failure
 * - DLQ after MAX_ATTEMPTS
 */
@Injectable()
export class OutboxBullMqRelay implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OutboxBullMqRelay.name);
  private queue: Queue<OutboxRelayJobData> | null = null;
  private worker: Worker<OutboxRelayJobData> | null = null;
  private metricsStopping = false;
  private queueClient?: Awaited<Queue<OutboxRelayJobData>["client"]>;
  private workerClient?: Awaited<Worker<OutboxRelayJobData>["client"]>;
  private blockingClient?: Awaited<ReturnType<Worker<OutboxRelayJobData>["waitUntilReady"]>>;
  private readonly ready?: Gauge;
  private readonly lastDispatch?: Gauge;

  constructor(private readonly dispatcher: OutboxDispatcher,
    @Optional() @Inject(MetricsService) metrics?: MetricsService) {
    if (metrics) {
      const registers = [metrics.registry];
      this.ready = new Gauge({ name: "outbox_relay_ready", help: "Whether the worker and its existing Redis clients are ready", registers,
        collect: () => this.ready!.set(!this.metricsStopping && this.worker?.isRunning() && this.queueClient?.status === "ready" &&
          this.workerClient?.status === "ready" && this.blockingClient?.status === "ready" ? 1 : 0) });
      this.lastDispatch = new Gauge({ name: "outbox_relay_last_dispatch_timestamp_seconds", help: "Last completed dispatcher round; not proof of external delivery", registers });
      this.lastDispatch.set(0);
    }
  }

  async onModuleInit(): Promise<void> {
    const connection = redisConnection();
    if (!connection) return; // OutboxDispatcher handles fallback

    this.queue = new Queue<OutboxRelayJobData>(OUTBOX_RELAY_QUEUE, { connection });
    // Observe the existing clients without waiting or changing startup flow.
    void this.queue.client.then(client => { this.queueClient = client; }).catch(() => {});

    // Ensure a recurring job fires every minute
    try {
      await this.queue.add(
        JOB_NAME,
        { triggeredAt: new Date().toISOString() },
        {
          jobId: RECURRING_JOB_KEY,
          repeat: { pattern: CRON_EVERY_SECOND },
          removeOnComplete: 100,
          removeOnFail: 500,
        },
      );
    } catch (err) {
      this.logger.error("Failed to ensure outbox relay recurring job", {
        error: err instanceof Error ? err.message : String(err),
      });
    }

    this.worker = new Worker<OutboxRelayJobData>(
      OUTBOX_RELAY_QUEUE,
      (job) => this.process(job),
      { connection, concurrency: 1 },
    );
    void this.worker.client.then(client => { this.workerClient = client; }).catch(() => {});
    void this.worker.waitUntilReady().then(client => { this.blockingClient = client; }).catch(() => {});

    this.worker.on("failed", (job, err) => {
      this.logger.warn(`Outbox relay job failed ${job?.id ?? "unknown"}: ${err.message}`);
    });

    this.logger.log("outbox-relay: BullMQ worker started (drain every minute)");
  }

  async onModuleDestroy(): Promise<void> {
    this.metricsStopping = true;
    await this.worker?.close();
    await this.queue?.close();
  }

  private async process(_job: Job<OutboxRelayJobData>): Promise<void> {
    // Run multiple dispatch passes within the 1-minute window to achieve
    // sub-second event delivery similar to the old 100ms interval.
    const deadline = Date.now() + 55_000; // stop 5s before next tick
    let passes = 0;
    while (Date.now() < deadline) {
      await this.dispatcher.dispatch();
      this.lastDispatch?.set(this.dispatcher.getLastCompletedRoundAt() / 1000);
      passes++;
      // Short sleep between passes to avoid busy-loop; 200ms → ~275 passes/min
      await new Promise((r) => setTimeout(r, 200));
    }
    if (passes > 0) {
      this.logger.debug(`Outbox relay: ${passes} dispatch passes this tick`);
    }
  }
}
