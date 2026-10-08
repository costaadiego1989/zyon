import { Injectable, Logger, type OnModuleInit, type OnModuleDestroy } from "@nestjs/common";
import { FundMarketplaceOrderUseCase } from "../../application/use-cases/fund-marketplace-order.use-case.js";
import { MarketplaceJobMetricsService } from "../marketplace-job-metrics.service.js";

/** Capture reads run independently so an unavailable PSP cannot delay funded payouts. */
@Injectable()
export class FundMarketplaceOrdersJob implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(FundMarketplaceOrdersJob.name);
  private timer?: ReturnType<typeof setInterval>;
  private running?: ReturnType<FundMarketplaceOrderUseCase["recover"]>;

  constructor(private readonly funding: FundMarketplaceOrderUseCase, private readonly metrics: MarketplaceJobMetricsService) {}

  onModuleInit(): void {
    const tick = () => { void this.runOnce().catch(() => this.logger.error({ event: "marketplace_funding_job_failed" })); };
    this.timer = setInterval(tick, 60_000);
    this.timer.unref();
    tick();
  }

  async onModuleDestroy(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    await this.running?.catch(() => {});
  }

  runOnce(): ReturnType<FundMarketplaceOrderUseCase["recover"]> {
    if (!this.running) {
      this.metrics.start("funding");
      this.running = this.funding.recover().then(result => {
        this.metrics.finish("funding", result.failed ? "partial" : "success");
        if (result.attempted) this.logger.log({ event: "marketplace_funding_recovery_completed", ...result });
        return result;
      }, error => {
        this.metrics.finish("funding", "failure");
        throw error;
      }).finally(() => { this.running = undefined; });
    }
    return this.running;
  }
}
