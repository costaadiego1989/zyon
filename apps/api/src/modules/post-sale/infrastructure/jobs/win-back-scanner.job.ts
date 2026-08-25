import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from "@nestjs/common";
import { ScanInactiveBuyersUseCase } from "../../application/use-cases/scan-inactive-buyers.use-case.js";

const SCAN_INTERVAL_MS = 24 * 60 * 60 * 1000; // daily

@Injectable()
export class WinBackScannerJob implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(WinBackScannerJob.name);
  private intervalHandle: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly useCase: ScanInactiveBuyersUseCase) {}

  onModuleInit(): void {
    this.intervalHandle = setInterval(() => {
      this.run().catch((err) => {
        this.logger.error("win-back-scanner: unhandled error", {
          error: err instanceof Error ? err.message : String(err),
        });
      });
    }, SCAN_INTERVAL_MS);

    this.logger.log("win-back-scanner: scheduled daily", { intervalMs: SCAN_INTERVAL_MS });
  }

  onModuleDestroy(): void {
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
      this.logger.log("win-back-scanner: interval cleared");
    }
  }

  private async run(): Promise<void> {
    const stats = await this.useCase.execute();
    if (stats.couponsCreated > 0) {
      this.logger.log("win-back-scanner: run complete", stats);
    }
  }
}
