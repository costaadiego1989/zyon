import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from "@nestjs/common";
import { ScanConsumableReordersUseCase } from "../../application/use-cases/scan-consumable-reorders.use-case.js";

const SCAN_INTERVAL_MS = 24 * 60 * 60 * 1000; // daily

@Injectable()
export class ConsumableReorderScannerJob implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ConsumableReorderScannerJob.name);
  private intervalHandle: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly useCase: ScanConsumableReordersUseCase) {}

  onModuleInit(): void {
    this.intervalHandle = setInterval(() => {
      this.run().catch((err) => {
        this.logger.error("consumable-reorder-scanner: unhandled error", {
          error: err instanceof Error ? err.message : String(err),
        });
      });
    }, SCAN_INTERVAL_MS);

    this.logger.log("consumable-reorder-scanner: scheduled daily", {
      intervalMs: SCAN_INTERVAL_MS,
    });
  }

  onModuleDestroy(): void {
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
      this.logger.log("consumable-reorder-scanner: interval cleared");
    }
  }

  private async run(): Promise<void> {
    const stats = await this.useCase.execute();
    if (stats.scheduled > 0) {
      this.logger.log("consumable-reorder-scanner: run complete", stats);
    }
  }
}
