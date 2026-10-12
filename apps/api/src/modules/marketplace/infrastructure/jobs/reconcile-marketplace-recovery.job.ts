import { Injectable, Logger, Optional, type OnModuleInit, type OnModuleDestroy } from "@nestjs/common";
import { ExecuteMarketplaceResidualUseCase } from "../../application/use-cases/execute-marketplace-residual.use-case.js";
import { ExecuteMarketplaceTransferReversalUseCase } from "../../application/use-cases/execute-marketplace-transfer-reversal.use-case.js";
import { MarketplaceJobMetricsService } from "../marketplace-job-metrics.service.js";
import { ExecuteMarketplaceShipmentService } from "../../../shipping/application/use-cases/execute-marketplace-shipment.service.js";
import { ExecuteMarketplaceCancellationUseCase } from "../../application/use-cases/execute-marketplace-cancellation.use-case.js";
import { MarketplaceAsaasWalletReturnService } from "../../application/marketplace-asaas-wallet-return.service.js";
import { MarketplaceAsaasResidualWalletReturnService } from "../../application/marketplace-asaas-residual-wallet-return.service.js";
import { MarketplaceRefundContributionService } from "../../application/marketplace-refund-contribution.service.js";
import { MarketplaceContributionCheckoutService } from "../../application/marketplace-contribution-checkout.service.js";
import { MarketplaceSellerFeeCollectionService } from "../../application/marketplace-seller-fee-collection.service.js";
import { MarketplaceHostFeeCollectionService } from "../../application/marketplace-host-fee-collection.service.js";

/** Reads uncertain operations only. It never admits new financial submissions. */
@Injectable()
export class ReconcileMarketplaceRecoveryJob implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ReconcileMarketplaceRecoveryJob.name);
  private timer?: ReturnType<typeof setInterval>;
  private running?: Promise<{ attempted: number; reconciled: number; failed: number }>;
  constructor(private readonly residuals: ExecuteMarketplaceResidualUseCase,
    private readonly reversals: ExecuteMarketplaceTransferReversalUseCase, private readonly shipments: ExecuteMarketplaceShipmentService,
    private readonly metrics: MarketplaceJobMetricsService, private readonly cancellations: ExecuteMarketplaceCancellationUseCase,
    @Optional() private readonly walletReturns?: MarketplaceAsaasWalletReturnService,
    @Optional() private readonly contributions?: MarketplaceRefundContributionService,
    @Optional() private readonly collections?: MarketplaceContributionCheckoutService,
    @Optional() private readonly residualWalletReturns?: MarketplaceAsaasResidualWalletReturnService,
    @Optional() private readonly sellerFees?: MarketplaceSellerFeeCollectionService,
    @Optional() private readonly hostFees?: MarketplaceHostFeeCollectionService) {}
  onModuleInit(): void {
    const tick = () => { void this.runOnce().catch(() => this.logger.error({ event: "marketplace_recovery_job_failed" })); };
    this.timer = setInterval(tick, 60_000); this.timer.unref(); tick();
  }
  async onModuleDestroy(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    await this.running?.catch(() => {});
  }
  runOnce() {
    if (!this.running) {
      this.metrics.start("recovery");
      this.running = this.recover().then(result => {
        this.metrics.finish("recovery", result.failed ? "partial" : "success");
        if (result.attempted || result.failed) this.logger.log({ event: "marketplace_recovery_job_completed", ...result });
        return result;
      }, error => { this.metrics.finish("recovery", "failure"); throw error; }).finally(() => { this.running = undefined; });
    }
    return this.running;
  }
  private async recover() {
    const queues = [this.residuals.recover(20), this.reversals.recover(20), this.shipments.recover(20), this.cancellations.recover(20)];
    if (this.walletReturns) queues.push(this.walletReturns.recover(20));
    if (this.contributions) queues.push(this.contributions.recover(20));
    if (this.collections) queues.push(this.collections.recover(20));
    if (this.residualWalletReturns) queues.push(this.residualWalletReturns.recover(20));
    if (this.sellerFees) queues.push(this.sellerFees.recover(20));
    if (this.hostFees) queues.push(this.hostFees.recover(20));
    const results = await Promise.allSettled(queues);
    const counts = { attempted: 0, reconciled: 0, failed: 0 };
    for (const result of results) {
      if (result.status === "rejected") counts.failed++;
      else { counts.attempted += result.value.attempted; counts.reconciled += result.value.reconciled; counts.failed += result.value.failed; }
    }
    return counts;
  }
}
