import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import { ErpSyncService } from "../../application/services/erp-sync.service.js";

/** Runs the durable ERP queue even when Redis is unavailable. */
@Injectable()
export class ErpSyncWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ErpSyncWorker.name);
  private timer?: NodeJS.Timeout;
  private periodicBucket = -1;

  constructor(private readonly sync: ErpSyncService) {}

  onModuleInit(): void {
    const tick = () => {
      const bucket = Math.floor(Date.now() / (15 * 60_000));
      if (this.periodicBucket !== bucket) {
        this.periodicBucket = bucket;
        void this.sync.enqueuePeriodic().catch(() => {
          this.periodicBucket = -1;
          this.logger.error("erp.periodic_enqueue_failed");
        });
      }
      void this.sync.drain().catch(() => this.logger.error("erp.worker_failed"));
    };
    // Reconcile immediately after a restart and on wall-clock boundaries.
    // Persistent bucket keys prevent duplicate jobs across replicas/restarts.
    tick();
    this.timer = setInterval(tick, 60_000);
    this.timer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }
}
