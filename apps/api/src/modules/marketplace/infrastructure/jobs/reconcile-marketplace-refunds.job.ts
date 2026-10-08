import { Injectable, Logger, type OnModuleInit, type OnModuleDestroy } from "@nestjs/common";
import { ExecuteMarketplaceRefundUseCase } from "../../application/use-cases/execute-marketplace-refund.use-case.js";
import { MarketplaceJobMetricsService } from "../marketplace-job-metrics.service.js";

/** Recovery only. Prepared refunds require explicit admission; ticks never POST. */
@Injectable()
export class ReconcileMarketplaceRefundsJob implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ReconcileMarketplaceRefundsJob.name);
  private timer?: ReturnType<typeof setInterval>;
  private running?: ReturnType<ExecuteMarketplaceRefundUseCase["recover"]>;
  constructor(private readonly refunds: ExecuteMarketplaceRefundUseCase, private readonly metrics: MarketplaceJobMetricsService) {}
  onModuleInit(): void {
    const tick = () => { void this.runOnce().catch(() => this.logger.error({ event: "marketplace_refund_recovery_failed" })); };
    this.timer = setInterval(tick, 60_000); this.timer.unref(); tick();
  }
  async onModuleDestroy(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    await this.running?.catch(() => {});
  }
  runOnce(): ReturnType<ExecuteMarketplaceRefundUseCase["recover"]> {
    if (!this.running) {
      this.metrics.start("refunds");
      this.running = this.refunds.recover(20).then(result => {
        this.metrics.finish("refunds", result.failed ? "partial" : "success");
        if (result.attempted) this.logger.log({ event: "marketplace_refund_recovery_completed", ...result });
        return result;
      }, error => { this.metrics.finish("refunds", "failure"); throw error; })
        .finally(() => { this.running = undefined; });
    }
    return this.running;
  }
}
