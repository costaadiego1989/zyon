import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { Queue, Worker } from "bullmq";
import { weeklyAnalysisEnabled } from "../../domain/weekly-analysis-policy.js";
import { WeeklyAnalysisService } from "../weekly-analysis.service.js";
import { StrategyReviewService } from "../../application/strategy-review.service.js";

export const WEEKLY_ANALYSIS_QUEUE = "revenue-weekly-analysis";

@Injectable()
export class WeeklyAnalysisJob implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(WeeklyAnalysisJob.name);
  private queue?: Queue;
  private worker?: Worker;
  constructor(private readonly service: WeeklyAnalysisService, private readonly strategies: StrategyReviewService) {}

  async onModuleInit() {
    if (!weeklyAnalysisEnabled() || process.env.REDIS_ENABLED === "false" || !process.env.REDIS_URL) return;
    const url = new URL(process.env.REDIS_URL);
    const connection = { host: url.hostname, port: Number(url.port || 6379),
      username: decodeURIComponent(url.username) || undefined, password: decodeURIComponent(url.password) || undefined,
      db: Number(url.pathname.slice(1) || 0), maxRetriesPerRequest: null,
      ...(url.protocol === "rediss:" ? { tls: {} } : {}) };
    this.queue = new Queue(WEEKLY_ANALYSIS_QUEUE, { connection });
    this.worker = new Worker(WEEKLY_ANALYSIS_QUEUE, async job => {
      if (job.name === "poll") {
        await Promise.all([this.service.dispatch(id => this.enqueue(id)),
          this.strategies.dispatch(id => this.enqueueRevision(id))]);
      }
      else if (job.name === "revise") await this.strategies.process(job.data.revisionId);
      else await this.service.process(job.data.runId);
    }, { connection, concurrency: 2 });
    this.worker.on("error", () => this.logger.error("Weekly analysis queue connection unavailable"));
    this.worker.on("failed", job => this.logger.warn(`Weekly analysis job failed: ${job?.name}`));
    // Enqueue failures cannot lose a persisted cycle: the next poll recovers it.
    await this.queue.add("poll", {}, { jobId: "weekly-analysis-poll", repeat: { every: 15 * 60_000 },
      removeOnComplete: 10, removeOnFail: 50 });
    await this.queue.add("poll", {}, { removeOnComplete: true, removeOnFail: 50 });
  }

  async enqueue(runId: string) {
    if (!this.queue) throw new Error("REVENUE_MANAGER_QUEUE_UNAVAILABLE");
    await this.queue.add("analyze", { runId }, { jobId: `analysis-${runId}`,
      removeOnComplete: true, removeOnFail: true, attempts: 1 });
  }

  async onModuleDestroy() { await this.worker?.close(); await this.queue?.close(); }

  private async enqueueRevision(revisionId: string) {
    if (!this.queue) throw new Error("REVENUE_MANAGER_QUEUE_UNAVAILABLE");
    await this.queue.add("revise", { revisionId }, { jobId: `revision-${revisionId}`,
      removeOnComplete: true, removeOnFail: true, attempts: 1 });
  }
}
