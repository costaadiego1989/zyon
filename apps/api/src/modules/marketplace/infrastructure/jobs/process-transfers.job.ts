import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from "@nestjs/common";
import { ProcessScheduledTransfersUseCase } from "../../application/use-cases/process-scheduled-transfers.use-case.js";

const PROCESS_INTERVAL_MS = 60 * 60 * 1000; // 1 hour

@Injectable()
export class ProcessTransfersJob implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ProcessTransfersJob.name);
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly processTransfersUseCase: ProcessScheduledTransfersUseCase,
  ) {}

  onModuleInit(): void {
    this.timer = setInterval(() => {
      void this.processTransfers().catch((err) => {
        this.logger.error(
          `Process transfers job failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      });
    }, PROCESS_INTERVAL_MS);
    this.logger.log("Process transfers job started (every 1 hour)");
  }

  onModuleDestroy(): void {
    if (this.timer) {
      clearInterval(this.timer);
    }
  }

  private async processTransfers(): Promise<void> {
    const result = await this.processTransfersUseCase.execute({});
    if (result.processed > 0) {
      this.logger.log(
        `Process transfers job: processed ${result.processed} settlement(s)`,
      );
    }
  }
}
