import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { ReconcileScheduledSubscriptionCancellationsUseCase } from "../payment-platform/billing/reconcile-scheduled-subscription-cancellations.use-case.js";

const SCHEDULED_CANCELLATION_INTERVAL_MS = 15 * 60 * 1_000;

@Injectable()
export class BillingScheduledCancellationJob implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(BillingScheduledCancellationJob.name);
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;

  constructor(
    private readonly reconcile: ReconcileScheduledSubscriptionCancellationsUseCase,
  ) {}

  onModuleInit(): void {
    void this.run();
    this.timer = setInterval(
      () => void this.run(),
      SCHEDULED_CANCELLATION_INTERVAL_MS,
    );
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async run() {
    if (this.running) return { suspended: 0, finalized: 0, failed: 0 };
    this.running = true;
    try {
      const result = await this.reconcile.execute();
      if (result.suspended || result.finalized || result.failed) {
        this.logger.log(
          `Billing cancellation reconciliation: suspended=${result.suspended} finalized=${result.finalized} failed=${result.failed}`,
        );
      }
      return result;
    } catch (error) {
      this.logger.warn(
        `Billing cancellation reconciliation failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      return { suspended: 0, finalized: 0, failed: 1 };
    } finally {
      this.running = false;
    }
  }
}
