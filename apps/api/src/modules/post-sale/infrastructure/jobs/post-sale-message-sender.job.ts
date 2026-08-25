import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from "@nestjs/common";
import { ProcessScheduledMessagesUseCase } from "../../application/use-cases/process-scheduled-messages.use-case.js";

const SCAN_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

@Injectable()
export class PostSaleMessageSenderJob implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PostSaleMessageSenderJob.name);
  private intervalHandle: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly useCase: ProcessScheduledMessagesUseCase) {}

  onModuleInit(): void {
    this.intervalHandle = setInterval(() => {
      this.run().catch((err) => {
        this.logger.error(
          "post-sale-message-sender: unhandled error",
          { error: err instanceof Error ? err.message : String(err) }
        );
      });
    }, SCAN_INTERVAL_MS);

    this.logger.log("post-sale-message-sender: scheduled for every 5 minutes", {
      intervalMs: SCAN_INTERVAL_MS,
    });
  }

  onModuleDestroy(): void {
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
      this.logger.log("post-sale-message-sender: interval cleared");
    }
  }

  private async run(): Promise<void> {
    const stats = await this.useCase.execute();
    if (stats.processed > 0) {
      this.logger.log("post-sale-message-sender: processed messages", {
        processed: stats.processed,
        sent: stats.sent,
        failed: stats.failed,
      });
    }
  }
}
