import { Injectable, Logger, OnModuleDestroy } from "@nestjs/common";
import { Queue } from "bullmq";
import { inventoryReconciliationRedisConnection, INVENTORY_RECONCILIATION_QUEUE } from "./inventory-reconciliation.shared.js";

const JOB_NAME = "reconcile";
const RECURRING_JOB_KEY = "inventory-reconciliation:cron";
const CRON_EVERY_15_MIN = "*/15 * * * *";

interface ReconcileJobData {
  triggeredAt: string;
}

/**
 * Single responsibility: register the recurring reconciliation cron on BullMQ.
 * No-op when Redis is not configured (the worker uses a setInterval fallback).
 */
@Injectable()
export class InventoryReconciliationScheduler implements OnModuleDestroy {
  private readonly logger = new Logger(InventoryReconciliationScheduler.name);
  private readonly queue: Queue<ReconcileJobData> | null;

  constructor() {
    const connection = inventoryReconciliationRedisConnection();
    this.queue = connection ? new Queue<ReconcileJobData>(INVENTORY_RECONCILIATION_QUEUE, { connection }) : null;
  }

  async ensureRecurringJob(): Promise<void> {
    if (!this.queue) return;
    try {
      await this.queue.add(JOB_NAME, { triggeredAt: new Date().toISOString() }, {
        jobId: RECURRING_JOB_KEY,
        repeat: { pattern: CRON_EVERY_15_MIN },
        removeOnComplete: 100,
        removeOnFail: 1_000,
      });
      this.logger.log(`Scheduled recurring inventory reconciliation (cron=${CRON_EVERY_15_MIN})`);
    } catch (err) {
      this.logger.warn(`Failed to register reconciliation job: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.queue?.close();
  }
}
