import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import { ErpSyncService } from "../../application/services/erp-sync.service.js";

/** Runs the durable ERP queue even when Redis is unavailable. */
@Injectable()
export class ErpSyncWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ErpSyncWorker.name);
  private timer?: NodeJS.Timeout;
  private ticks = 0;

  constructor(private readonly sync: ErpSyncService) {}

  onModuleInit(): void {
    void this.sync.drain().catch((error) => this.logger.error("erp.recovery_failed", error));
    this.timer = setInterval(() => {
      this.ticks += 1;
      if (this.ticks % 15 === 0) void this.sync.enqueuePeriodic();
      void this.sync.drain().catch((error) => this.logger.error("erp.worker_failed", error));
    }, 60_000);
    this.timer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }
}
