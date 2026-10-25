import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { Queue, Worker } from "bullmq";
import { StrategyMonitorService } from "../strategy-monitor.service.js";

@Injectable()
export class StrategyMonitorJob implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(StrategyMonitorJob.name);
  private queue?: Queue;
  private worker?: Worker;
  constructor(private readonly service: StrategyMonitorService) {}

  async onModuleInit() {
    if (process.env.REVENUE_STRATEGY_MONITOR_ENABLED !== "true" || process.env.REDIS_ENABLED === "false" || !process.env.REDIS_URL?.trim()) return;
    const url = new URL(process.env.REDIS_URL);
    const connection = { host: url.hostname, port: Number(url.port || 6379), db: Number(url.pathname.slice(1) || 0),
      username: decodeURIComponent(url.username) || undefined, password: decodeURIComponent(url.password) || undefined,
      maxRetriesPerRequest: null, ...(url.protocol === "rediss:" ? { tls: {} } : {}) };
    this.queue = new Queue("revenue-strategy-monitor", { connection });
    this.queue.on("error", () => this.logger.error("Strategy monitor queue connection unavailable"));
    this.worker = new Worker("revenue-strategy-monitor", async () => {
      const result = await this.service.run();
      if (result.failed) throw new Error("STRATEGY_MONITOR_COLLECTION_INCOMPLETE");
    }, { connection, concurrency: 1 });
    this.worker.on("error", () => this.logger.error("Strategy monitor queue connection unavailable"));
    this.worker.on("failed", () => this.logger.warn("Strategy monitor will retry incomplete results on the next poll"));
    await this.queue.add("poll", {}, { jobId: "strategy-monitor-poll", repeat: { every: 15 * 60_000 }, removeOnComplete: 10, removeOnFail: 50 });
    await this.queue.add("poll", {}, { removeOnComplete: true, removeOnFail: 50 });
  }

  async onModuleDestroy() { await this.worker?.close(); await this.queue?.close(); }
}
