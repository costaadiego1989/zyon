import { Injectable, Logger, Optional, OnModuleInit, OnModuleDestroy } from "@nestjs/common";
import { ProcessScheduledTransfersUseCase } from "../../application/use-cases/process-scheduled-transfers.use-case.js";
import { MarketplaceJobMetricsService } from "../marketplace-job-metrics.service.js";

const PROCESS_INTERVAL_MS = 60 * 60 * 1000; // 1 hour

@Injectable()
export class ProcessTransfersJob implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ProcessTransfersJob.name);
  private timer: ReturnType<typeof setInterval> | null = null;
  private running?: Promise<void>;

  constructor(
    private readonly processTransfersUseCase: ProcessScheduledTransfersUseCase,
    @Optional() private readonly metrics?: MarketplaceJobMetricsService,
  ) {}

  onModuleInit(): void {
    const tick = () => { void this.runOnce().catch(() => this.logger.error({ event: "marketplace_transfer_job_failed" })); };
    this.timer = setInterval(tick, PROCESS_INTERVAL_MS);
    this.timer.unref();
    tick();
    this.logger.log("Process transfers job started (every 1 hour)");
  }

  async onModuleDestroy(): Promise<void> {
    if (this.timer) {
      clearInterval(this.timer);
    }
    await this.running?.catch(() => {});
  }

  runOnce(): Promise<void> {
    if (!this.running) {
      this.metrics?.start("payouts");
      this.running = this.processTransfers().catch(error => {
        this.metrics?.finish("payouts", "failure");
        throw error;
      }).finally(() => { this.running = undefined; });
    }
    return this.running;
  }

  private async processTransfers(): Promise<void> {
    const result = await this.processTransfersUseCase.execute({});
    this.metrics?.finish("payouts", result.transfersBlocked + result.schedulesBlocked ? "partial" : "success");
    if (result.processed > 0) {
      this.logger.log(
        `Process transfers job: processed ${result.processed} settlement(s)`,
      );
    }
  }
}
