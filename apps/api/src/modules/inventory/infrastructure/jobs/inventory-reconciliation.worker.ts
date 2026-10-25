import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { Worker, type Job } from "bullmq";
import { ReconcileCatalogStockUseCase } from "../../application/use-cases/reconcile-catalog-stock.use-case.js";
import { InventoryReconciliationScheduler } from "./inventory-reconciliation.scheduler.js";
import { inventoryReconciliationRedisConnection, INVENTORY_RECONCILIATION_QUEUE } from "./inventory-reconciliation.shared.js";

interface ReconcileJobData {
  triggeredAt: string;
}

const INTERVAL_MS = 15 * 60 * 1_000;

/**
 * Single responsibility: run the reconciliation use-case on a schedule. Uses
 * BullMQ when Redis is present, otherwise a setInterval fallback. Holds no
 * reconciliation logic itself — it only invokes the use-case.
 */
@Injectable()
export class InventoryReconciliationWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(InventoryReconciliationWorker.name);
  private worker: Worker<ReconcileJobData> | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly reconcile: ReconcileCatalogStockUseCase,
    private readonly scheduler: InventoryReconciliationScheduler,
  ) {}

  async onModuleInit(): Promise<void> {
    const connection = inventoryReconciliationRedisConnection();
    if (connection) {
      await this.scheduler.ensureRecurringJob();
      this.worker = new Worker<ReconcileJobData>(
        INVENTORY_RECONCILIATION_QUEUE,
        (job) => this.process(job),
        { connection, concurrency: 2 },
      );
      this.worker.on("failed", (job, err) => {
        this.logger.warn(`Reconciliation job failed ${job?.id ?? "unknown"}: ${err.message}`);
      });
    } else {
      this.timer = setInterval(() => {
        void this.reconcile.execute().catch((err) => {
          this.logger.warn(`Reconciliation timer failed: ${err instanceof Error ? err.message : String(err)}`);
        });
      }, INTERVAL_MS);
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    await this.worker?.close();
  }

  private async process(job: Job<ReconcileJobData>): Promise<void> {
    const corrected = await this.reconcile.execute();
    this.logger.log(`Reconciliation tick ${job.id ?? "n/a"} corrected=${corrected}`);
  }
}
